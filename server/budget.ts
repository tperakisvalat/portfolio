import { randomUUID } from 'node:crypto'
import type { Database } from './db.js'
import { audit, HttpError } from './store.js'
import { z } from 'zod'
import { setTimeout as delay } from 'node:timers/promises'

// Pricing is deliberately not inferred from model names. The broker only runs with
// a dated, operator-verified pricing file; conservative reservations include all tools.
export interface Price { input: number; output: number; cacheWrite: number }
export const DayAllowance=z.object({day:z.iso.date(),targetUsd:z.number().min(0).max(100),softUsd:z.number().min(0).max(100),hardUsd:z.number().min(0).max(100),reason:z.string().min(10).max(1000)}).strict().refine(v=>v.targetUsd<=v.softUsd&&v.softUsd<=v.hardUsd,'Budget thresholds must be ordered')
export async function effectiveBudget(db:Database,normal:{targetUsd:number;softUsd:number;hardUsd:number},day=new Date().toISOString().slice(0,10)) {
  const [row]=await db.query<any>("SELECT after_value FROM news_private.audit WHERE action='budget.day_allowance' AND entity_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",[day])
  const parsed=DayAllowance.safeParse(row?.after_value)
  return parsed.success&&parsed.data.day===day?{targetUsd:parsed.data.targetUsd,softUsd:parsed.data.softUsd,hardUsd:parsed.data.hardUsd,day,temporary:true}:{...normal,day,temporary:false}
}
export async function setDayAllowance(db:Database,actor:string,input:unknown) {
  const value=DayAllowance.parse(input)
  if(value.day!==new Date().toISOString().slice(0,10))throw new HttpError(422,'A testing allowance applies only to the current UTC budget day')
  return db.transaction(async tx=>{
    await tx.query('INSERT INTO news_private.daily_budget(day,limit_usd) VALUES($1,$2) ON CONFLICT(day) DO NOTHING',[value.day,value.hardUsd])
    const [before]=await tx.query<any>('SELECT * FROM news_private.daily_budget WHERE day=$1 FOR UPDATE',[value.day])
    await audit(tx,actor,'budget.day_allowance',value.day,before,value)
    await tx.query('UPDATE news_private.daily_budget SET limit_usd=$2 WHERE day=$1',[value.day,value.hardUsd])
    return value
  })
}
export async function usageContext(db:Database,id:string,details:Record<string,unknown>) {
  // Operational measurements only: no private prompts or hidden reasoning.
  await audit(db,'meter','usage.context',id,null,details)
}
export function upperBound(body: Record<string, any>, price: Price, countedInputTokens?:number) {
  if (body.previous_response_id || body.conversation || body.prompt || body.background || body.tools?.some((t:any)=>t.type !== 'function' && t.type !== 'custom')) throw new HttpError(422,'Unbounded context or unmetered native tools rejected')
  const output=Number(body.max_output_tokens)
  if (!Number.isInteger(output) || output < 1 || output > 16000) throw new HttpError(422,'Bounded max_output_tokens required')
  // UTF-8 bytes is a conservative input-token bound; add framing overhead.
  const bytes=Buffer.byteLength(JSON.stringify(body),'utf8')
  if(bytes>900000)throw new HttpError(422,'Editorial request exceeds transport bound')
  if(countedInputTokens!==undefined&&(!Number.isInteger(countedInputTokens)||countedInputTokens<1))throw new HttpError(422,'Invalid provider token count')
  const input=(countedInputTokens??bytes)+4096
  if (input > 240000) throw new HttpError(422,'Context exceeds this worker’s cost bound; narrow the task')
  // This byte bound is below the verified 272k INPUT-token premium threshold.
  // Reserving long-context rates as well double-counted a premium that cannot
  // apply to accepted requests. Hosted search has its own larger reservation.
  return Math.ceil(((input*Math.max(price.input,price.cacheWrite)+output*price.output)/1e6)*1e6)/1e6
}
export async function requestCostBound(body:Record<string,any>,price:Price,signal:AbortSignal,providerFetch:typeof fetch=fetch) {
  // Validate the same bounded text/tool restrictions BEFORE the counting request.
  upperBound(body,price,1)
  if(Buffer.byteLength(JSON.stringify(body),'utf8')<=60000)return upperBound(body,price)
  const fields=['model','input','instructions','parallel_tool_calls','personality','reasoning','text','tool_choice','tools','truncation']
  const payload=Object.fromEntries(fields.filter(key=>body[key]!==undefined).map(key=>[key,body[key]]))
  const response=await providerFetch('https://api.openai.com/v1/responses/input_tokens',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])})
  if(!response.ok)throw new HttpError(502,`Input token count failed (${response.status}); generation was not started`)
  const data=await response.json()
  if(data.object!=='response.input_tokens'||!Number.isInteger(data.input_tokens)||data.input_tokens<1)throw new HttpError(502,'Invalid token count; generation was not started')
  return upperBound(body,price,data.input_tokens)
}
export async function reserve(db: Database,runId:string,model:string,usd:number,limit:number,day=new Date().toISOString().slice(0,10)) {
  if(!Number.isFinite(usd)||usd<=0||!Number.isFinite(limit)||limit<0)throw new HttpError(422,'Invalid budget reservation')
  return db.transaction(async tx=>{
    const [run]=await tx.query<any>('SELECT status FROM news_private.runs WHERE id=$1 FOR UPDATE',[runId])
    if(!run||run.status!=='running')throw new HttpError(409,'Run is not active')
    await tx.query('INSERT INTO news_private.daily_budget(day,limit_usd) VALUES($1,$2) ON CONFLICT(day) DO NOTHING',[day,limit])
    const [budget]=await tx.query<any>('SELECT * FROM news_private.daily_budget WHERE day=$1 FOR UPDATE',[day])
    const allowance=await effectiveBudget(tx,{targetUsd:limit,softUsd:limit,hardUsd:limit},day)
    const effectiveLimit=Math.min(Number(budget.limit_usd),allowance.hardUsd)
    if(Number(budget.committed_usd)+usd>effectiveLimit)throw new HttpError(429,'Daily budget would be exceeded')
    await tx.query('UPDATE news_private.daily_budget SET limit_usd=$2,committed_usd=committed_usd+$3 WHERE day=$1',[day,effectiveLimit,usd])
    const id=randomUUID()
    await tx.query("INSERT INTO news_private.usage(id,run_id,day,model,reserved_usd,state) VALUES($1,$2,$3,$4,$5,'reserved')",[id,runId,day,model,usd])
    return id
  })
}
export async function reserveWhenAvailable(db:Database,runId:string,model:string,usd:number,limit:number,signal:AbortSignal,options:{day?:string;waitMs?:number;pollMs?:number}={}) {
  const deadline=Date.now()+(options.waitMs??180000)
  for(;;) {
    signal.throwIfAborted()
    const day=options.day??new Date().toISOString().slice(0,10)
    try{return await reserve(db,runId,model,usd,limit,day)}catch(error) {
      if(!(error instanceof HttpError)||error.statusCode!==429||usd>limit||Date.now()>=deadline)throw error
      const [pending]=await db.query<any>("SELECT EXISTS(SELECT 1 FROM news_private.usage WHERE day=$1 AND state='reserved') AS active",[day])
      // Only a live call can free headroom. Unknown costs must NEVER be cleared
      // or treated as available. Wait outside all transactions/row locks.
      // A call may have settled between the failed admission and this read.
      // One final atomic attempt distinguishes that race from a real exhausted cap.
      if(!pending?.active)return await reserve(db,runId,model,usd,limit,day)
      await delay(options.pollMs??500,undefined,{signal})
    }
  }
}
export async function settle(db:Database,id:string,actual:number|null,requestId?:string) {
  if(actual!==null&&(!Number.isFinite(actual)||actual<0))throw new HttpError(422,'Invalid provider cost')
  return db.transaction(async tx=>{
    const [usage]=await tx.query<any>('SELECT * FROM news_private.usage WHERE id=$1 FOR UPDATE',[id])
    if(!usage||usage.state==='settled')return
    if(actual===null){await tx.query("UPDATE news_private.usage SET state='unknown' WHERE id=$1",[id]);return}
    // If provider usage exceeds the bound, record the overrun honestly and prevent further calls.
    await tx.query('UPDATE news_private.daily_budget SET committed_usd=committed_usd+$2 WHERE day=$1',[usage.day,actual-Number(usage.reserved_usd)])
    await tx.query("UPDATE news_private.usage SET actual_usd=$2,state='settled',provider_request_id=$3,settled_at=now() WHERE id=$1",[id,actual,requestId||null])
    if(actual>Number(usage.reserved_usd))await tx.query("UPDATE news_private.runs SET status='failed',error='Provider cost exceeded conservative reservation',finished_at=now() WHERE id=$1",[usage.run_id])
  })
}
