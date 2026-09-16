import { setTimeout as delay } from 'node:timers/promises'

export async function runDoctor({
  token, base='http://127.0.0.1:8080/api/news/v1/admin', account=false, paidRun=false,
  log=console.log, pollMs=5000, timeoutMs=50*60*1000,
}: {token:string;base?:string;account?:boolean;paidRun?:boolean;log?:(message:string)=>void;pollMs?:number;timeoutMs?:number}) {
  if(!token)throw new Error('Local desk key is missing; run npm run news:setup, then npm run news:start')
  const redact=(message:string)=>message.replaceAll(token,'[redacted]').replace(/sk-[A-Za-z0-9_-]+/g,'[redacted]').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,1000)
  async function request(path:string,label:string,post=false) {
    let response:Response
    try {
      response=await fetch(`${base}${path}`,{
        method:post?'POST':'GET',
        headers:{Authorization:`Bearer ${token}`,...(post?{'Content-Type':'application/json'}:{})},
        ...(post?{body:'{}'}:{}), signal:AbortSignal.timeout(20000), redirect:'error',
      })
    }catch {
      throw new Error(`${label}: could not reach the news desk.${post?' The run may have been accepted; inspect /admin → runs before retrying. No automatic retry was made.':''}`)
    }
    const data=await response.json().catch(()=>null)
    if(!response.ok)throw new Error(`${label} (${response.status})${typeof data?.error==='string'?`: ${redact(data.error)}`:''}`)
    if(!data)throw new Error(`${label}: invalid server response`)
    return data
  }
  const report=await request(`/readiness${account?'?account=true':''}`,'Readiness check failed')
  for(const check of report.checks)log(`${check.ok?'OK':check.required?'MISSING':'OPTIONAL'} / ${check.name} / ${check.detail}`)
  if(!report.ready)throw new Error('Resolve required checks before a paid run')
  if(!paidRun)return
  log('Starting one real editorial run. This uses your configured daily budget; it does NOT publish.')
  const run=await request('/runs','Could not queue run',true),deadline=Date.now()+timeoutMs
  log(`Run / ${run.id}`)
  let last=''
  while(Date.now()<deadline) {
    const state=await request(`/runs/${encodeURIComponent(run.id)}`,`Could not check run ${run.id}; inspect /admin → runs before starting another`)
    if(state.status!==last){last=state.status;log(`Editor / ${last}`)}
    if(state.status==='review') {
      if(!state.draft_id)throw new Error('Run reached review without a saved draft ID')
      log(`PASS / real draft saved: ${state.draft_id}\nReview it in /admin → inbox. No content has been published.`)
      return
    }
    if(['failed','cancelled'].includes(state.status))throw new Error(redact(state.error||state.status))
    await delay(pollMs)
  }
  throw new Error(`Verification timed out. Inspect run ${run.id} in /admin; no automatic retry was started.`)
}
