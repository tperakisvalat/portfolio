import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runExecutor } from '../server/executor-client.js'

const base='http://executor.fixture',input={id:'synthetic-job',token:'ephemeral-fixture-token'}
test('lost executor acknowledgement cancels the exact job without retrying submission',async()=>{
  const calls:string[]=[]
  const transport:typeof fetch=async(url:any,init:any)=>{
    calls.push(String(url));assert.equal(init.headers.Authorization,'Bearer fixture-credential')
    if(String(url).endsWith('/cancel'))return Response.json({ok:true})
    throw new Error('Lost start acknowledgement')
  }
  await assert.rejects(()=>runExecutor(base,'fixture-credential',input,new AbortController().signal,transport),/Lost start acknowledgement/)
  assert.deepEqual(calls,[`${base}/jobs`,`${base}/jobs/${input.id}/cancel`])
})

test('completed executor result is returned once even if cleanup is unavailable',async()=>{
  const transport:typeof fetch=async(url:any)=>{
    if(String(url).endsWith('/cancel'))throw new Error('Cleanup unavailable')
    if(String(url).endsWith('/jobs'))return Response.json({status:'running'},{status:202})
    return Response.json({status:'completed',result:{contentHash:'a'.repeat(64)}})
  }
  assert.deepEqual(await runExecutor(base,'fixture-credential',input,new AbortController().signal,transport),{contentHash:'a'.repeat(64)})
})

test('cancellation interrupts polling and cleanup uses a fresh, un-aborted signal',async()=>{
  const controller=new AbortController();let polls=0,cleanups=0
  const transport:typeof fetch=async(url:any,init:any)=>{
    if(String(url).endsWith('/cancel')){cleanups++;assert.equal(init.signal.aborted,false);return Response.json({ok:true})}
    if(String(url).endsWith('/jobs'))return Response.json({status:'running'},{status:202})
    polls++;controller.abort();return Response.json({status:'running'})
  }
  await assert.rejects(()=>runExecutor(base,'fixture-credential',input,controller.signal,transport),{name:'AbortError'})
  assert.equal(polls,1);assert.equal(cleanups,1)
  await assert.rejects(()=>runExecutor(base,'fixture-credential',input,controller.signal,async()=>{assert.fail('Already cancelled work must not submit')}),{name:'AbortError'})
})

test('failed, missing and invalid executor states stop without resubmitting',async()=>{
  for(const status of ['failed','missing','unexpected']) {
    let starts=0,cancels=0
    const transport:typeof fetch=async(url:any)=>{
      if(String(url).endsWith('/cancel')){cancels++;return Response.json({ok:true})}
      if(String(url).endsWith('/jobs')){starts++;return Response.json({status:'running'},{status:202})}
      if(status==='missing')return Response.json({error:'Job not found'},{status:404})
      return Response.json({status,error:status==='failed'?'Fixture execution failed':undefined})
    }
    await assert.rejects(()=>runExecutor(base,'fixture-credential',input,new AbortController().signal,transport),/failed|unavailable|unknown/)
    assert.equal(starts,1);assert.equal(cancels,1)
  }
})
