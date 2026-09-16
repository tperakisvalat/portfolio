// This process has no database or provider credentials. In Compose it has no
// internet route, no host mounts, a read-only filesystem and a private /tmp.
import Fastify from 'fastify'
import { Codex } from '@openai/codex-sdk'
import { z } from 'zod'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Settings, DraftReceipt } from '../shared/news.js'

// A revision includes the exact prior draft and its evidence. Keep a bounded
// transport envelope large enough for it; the broker still counts input tokens
// and reserves each paid request independently before model execution.
export const Execution=z.object({id:z.uuid(),token:z.string().min(32).max(100),settings:Settings,prompt:z.string().max(180000)}).strict()
export function editorialMcpConfig(url:string) {
  // Explicit unattended permissions apply ONLY to this bounded server/tool set.
  // Research may spend within the broker's budget; none can publish or configure.
  const names=['desk_snapshot','plan_edition','review_draft','candidates','source_directory','approved_markets','read_evidence','prior_editions','research','research_notes','read_research','reader_feedback','topics','budget','validate_draft']
  return {url,bearer_token_env_var:'NEWS_RUN_TOKEN',required:true,tool_timeout_sec:390,
    enabled_tools:names,default_tools_approval_mode:'prompt',
    tools:Object.fromEntries(names.map(name=>[name,{approval_mode:'approve'}])),
  }
}
export async function executeCodex(input:z.infer<typeof Execution>,signal:AbortSignal) {
  if(process.env.NEWS_EXECUTOR_CONTAINER!=='true')throw new Error('Executor only runs in the packaged container')
  const root=await mkdtemp(join(tmpdir(),'tpv-editor-')),work=join(root,'work'),configHome=join(root,'codex')
  try {
    await mkdir(work);await mkdir(configHome)
    // Hard-coded service endpoint: callers cannot direct the agent at another host.
    const bridge='http://desk:8790'
    const codex=new Codex({env:{PATH:process.env.PATH || '/usr/bin:/bin',HOME:root,CODEX_HOME:configHome,NEWS_RUN_TOKEN:input.token},
      config:{model_provider:'editor',model_providers:{editor:{name:'Metered editorial broker',base_url:`${bridge}/v1`,env_key:'NEWS_RUN_TOKEN',requires_openai_auth:false,wire_api:'responses',request_max_retries:0,stream_max_retries:0,supports_websockets:false}},
        features:{shell_tool:false},web_search:'disabled',agents:{enabled:true,max_concurrent_threads_per_session:3,default_subagent_model:input.settings.helperModel,default_subagent_reasoning_effort:'low'},
        mcp_servers:{editorial:editorialMcpConfig(`${bridge}/mcp`)},
      },
    })
    const thread=codex.startThread({model:input.settings.mainModel,modelReasoningEffort:'high',workingDirectory:work,skipGitRepoCheck:true,sandboxMode:'read-only',approvalPolicy:'never',networkAccessEnabled:false,webSearchMode:'disabled'})
    const result=await thread.run(input.prompt,{outputSchema:z.toJSONSchema(DraftReceipt,{io:'output'}),signal})
    return DraftReceipt.parse(JSON.parse(result.finalResponse))
  } finally {await rm(root,{recursive:true,force:true,maxRetries:8,retryDelay:250})}
}
export function createExecutor(runner=executeCodex) {
  const app=Fastify({bodyLimit:900000,logger:false}),jobs=new Map<string,{controller:AbortController;status:string;result?:unknown;error?:string}>()
  app.addHook('onRequest',async(req,reply)=>{if(!process.env.NEWS_EXECUTOR_TOKEN || req.headers.authorization!==`Bearer ${process.env.NEWS_EXECUTOR_TOKEN}`)return reply.code(401).send({error:'Executor credential required'})})
  app.get('/health',async()=>({ok:true,isolation:'compose-private-network',active:[...jobs.values()].some(j=>j.status==='running')}))
  app.post('/jobs',async(req,reply)=>{
    const parsed=Execution.safeParse(req.body)
    if(!parsed.success)return reply.code(422).send({error:'Invalid execution request; check field limits',issues:parsed.error.issues.map(issue=>({path:issue.path,code:issue.code}))})
    const input=parsed.data
    if(jobs.has(input.id))return {id:input.id,status:jobs.get(input.id)!.status}
    if([...jobs.values()].some(j=>j.status==='running'))return reply.code(409).send({error:'Executor busy'})
    // Only retain the most recent result in memory; no transcript persistence here.
    jobs.clear()
    const job={controller:new AbortController(),status:'running'} as {controller:AbortController;status:string;result?:unknown;error?:string}
    jobs.set(input.id,job)
    const timeout=setTimeout(()=>job.controller.abort(),45*60*1000)
    void runner(input,job.controller.signal).then(result=>{job.result=result;job.status='completed'}).catch(error=>{job.error=error instanceof Error?error.message.slice(0,600):'Executor failed';job.status='failed'}).finally(()=>clearTimeout(timeout))
    return reply.code(202).send({id:input.id,status:'running'})
  })
  app.get('/jobs/:id',async(req:any,reply)=>{const job=jobs.get(req.params.id);if(!job)return reply.code(404).send({error:'Job not found; executor may have restarted'});return {status:job.status,result:job.result,error:job.error}})
  app.post('/jobs/:id/cancel',async(req:any)=>{jobs.get(req.params.id)?.controller.abort();return {ok:true}})
  app.addHook('onClose',async()=>{for(const job of jobs.values())job.controller.abort()})
  return app
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const app=createExecutor();await app.listen({host:'0.0.0.0',port:8791})
  process.once('SIGTERM',()=>void app.close());process.once('SIGINT',()=>void app.close())
}
