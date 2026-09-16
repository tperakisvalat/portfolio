import { setTimeout as delay } from 'node:timers/promises'

// A lost POST response is not proof that the executor did not accept the job.
// Always cancel that exact ID on exit, with a fresh bounded cleanup signal.
export async function runExecutor(executor:string,credential:string,input:{id:string;[key:string]:unknown},signal:AbortSignal,fetcher:typeof fetch=fetch,pollMs=1000) {
  signal.throwIfAborted()
  const base=executor.replace(/\/$/,''),jobUrl=`${base}/jobs/${encodeURIComponent(input.id)}`
  const headers={Authorization:`Bearer ${credential}`,'Content-Type':'application/json'}
  try {
    const started=await fetcher(`${base}/jobs`,{method:'POST',headers,body:JSON.stringify(input),redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])})
    if(!started.ok)throw new Error(`Executor refused job (${started.status})`)
    for(;;) {
      signal.throwIfAborted()
      const response=await fetcher(jobUrl,{headers,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])})
      if(!response.ok)throw new Error(`Executor state unavailable (${response.status})`)
      const job=await response.json()
      signal.throwIfAborted()
      if(job.status==='completed')return job.result
      if(job.status==='failed')throw new Error(job.error || 'Editor execution failed')
      if(job.status!=='running')throw new Error('Executor returned an unknown job state')
      await delay(pollMs,undefined,{signal})
    }
  } finally {
    await fetcher(`${jobUrl}/cancel`,{method:'POST',headers,body:'{}',redirect:'error',signal:AbortSignal.timeout(5000)}).catch(()=>{})
  }
}
