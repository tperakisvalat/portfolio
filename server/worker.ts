import { randomUUID } from 'node:crypto'
import { runEditor } from './editor.js'
import type { Database } from './db.js'
import { collectDue, queueScheduled } from './scheduler.js'
import { refreshMarkets } from './markets.js'

// Claim and finish only the lease owned by this process. The settings row is the
// shared lock: two worker processes may collect, but cannot commission in parallel.
export async function runQueuedEdition(db:Database,workerId:string,signal:AbortSignal,editor=runEditor,heartbeatMs=20000) {
  if(signal.aborted)return
  const run=await db.transaction(async tx=>{
    await tx.query("SELECT id FROM news_private.settings WHERE id='editor' FOR UPDATE")
    if(signal.aborted)return null
    await tx.query("UPDATE news_private.runs SET status='failed',error='Worker lease expired; inspect usage before retrying',finished_at=now() WHERE status='running' AND (lease_until IS NULL OR lease_until<now())")
    if((await tx.query("SELECT id FROM news_private.runs WHERE status='running' LIMIT 1")).length)return null
    const [row]=await tx.query<any>("SELECT * FROM news_private.runs WHERE status='queued' ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1")
    if(!row || signal.aborted)return null
    return (await tx.query<any>("UPDATE news_private.runs SET status='running',started_at=now(),lease_until=now()+interval '2 minutes',worker_id=$2 WHERE id=$1 RETURNING *",[row.id,workerId]))[0]
  })
  if(!run)return
  const lease=new AbortController(),activeSignal=AbortSignal.any([signal,lease.signal])
  let renewing:Promise<void>|undefined
  const heartbeat=setInterval(()=>{
    if(renewing)return
    renewing=db.query("UPDATE news_private.runs SET lease_until=now()+interval '2 minutes' WHERE id=$1 AND worker_id=$2 AND status='running' AND lease_until>now() RETURNING id",[run.id,workerId])
      .then(rows=>{if(!rows.length)lease.abort()}).catch(()=>lease.abort()).finally(()=>{renewing=undefined})
  },heartbeatMs)
  try {
    activeSignal.throwIfAborted()
    const draft=await editor(db,run,activeSignal)
    activeSignal.throwIfAborted()
    await db.query("UPDATE news_private.runs SET status='review',draft_id=$2,finished_at=now(),lease_until=NULL WHERE id=$1 AND worker_id=$3 AND status='running' AND lease_until>now()",[run.id,draft.id,workerId])
  } catch(error) {
    const message=signal.aborted?'Worker stopped; inspect saved research and usage before retrying':lease.signal.aborted?'Worker lease lost; inspect usage before retrying':error instanceof Error?error.message.slice(0,600):'Editor failed'
    await db.query("UPDATE news_private.runs SET status='failed',error=$2,finished_at=now(),lease_until=NULL WHERE id=$1 AND worker_id=$3 AND status='running'",[run.id,message,workerId])
  } finally {clearInterval(heartbeat);await renewing}
}

export async function workerLoop(db:Database,signal:AbortSignal,editor=runEditor) {
  // This gate must apply to the packaged entry point too, not just admin buttons.
  if(process.env.NEWS_WORKER_ENABLED!=='true')return
  const workerId=randomUUID()
  while(!signal.aborted) {
    try {
      await collectDue(db,undefined,signal)
      if(signal.aborted)break
      await refreshMarkets(db,undefined,signal)
      if(signal.aborted)break
      if(process.env.OPENAI_API_KEY)await queueScheduled(db)
      if(signal.aborted)break
      await runQueuedEdition(db,workerId,signal,editor)
    }catch(error){console.error('Worker iteration failed:',error instanceof Error?error.message:'unknown')}
    if(!signal.aborted)await new Promise(resolve=>{const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve(null)};const timer=setTimeout(done,10000);signal.addEventListener('abort',done,{once:true})})
  }
}
