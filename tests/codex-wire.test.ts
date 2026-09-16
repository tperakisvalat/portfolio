import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { Codex } from '@openai/codex-sdk'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { upperBound } from '../server/budget.js'
import { DraftReceipt } from '../shared/news.js'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { editorialMcpConfig } from '../server/executor.js'

test('installed Codex runtime calls the allowlisted editorial MCP tool unattended and completes a turn', {timeout:30000}, async()=>{
  const root=await mkdtemp(join(tmpdir(),'news-wire-')),configHome=join(root,'codex'),work=join(root,'work')
  await mkdir(configHome);await mkdir(work)
  const app=Fastify({bodyLimit:1000000}),requests:any[]=[]
  let calls=0
  app.post('/mcp',async(req,reply)=>{
    assert.equal(req.headers.authorization,'Bearer fake-no-provider-key')
    const mcp=new McpServer({name:'fixture',version:'1.0'})
    // Intentionally no readOnly annotation: the explicit per-tool permission
    // must work for bounded paid research as well as metadata reads.
    mcp.registerTool('candidates',{inputSchema:{}},async()=>{calls++;return {content:[{type:'text',text:'fixture-evidence-123'}]}})
    mcp.registerTool('publish_edition',{inputSchema:{}},async()=>{assert.fail('Publication must never be exposed')})
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined})
    await mcp.connect(transport);reply.hijack()
    reply.raw.once('close',()=>{void transport.close();void mcp.close()})
    await transport.handleRequest(req.raw,reply.raw,req.body)
  })
  const answer=JSON.stringify(DraftReceipt.parse({contentHash:'a'.repeat(64)}))
  app.post('/v1/responses',async(req:any,reply)=>{
    requests.push(req.body)
    if(requests.length===1) {
      const call={id:'fc_fixture',type:'custom_tool_call',call_id:'call_fixture',namespace:'functions',name:'exec',input:'text(await tools.mcp__editorial__candidates({}));',status:'completed'}
      const response={id:'resp_call',object:'response',status:'completed',output:[call],usage:{input_tokens:100,output_tokens:5,total_tokens:105}}
      const events=[{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item:{...call,status:'in_progress',input:''}},{type:'response.custom_tool_call_input.delta',output_index:0,item_id:call.id,delta:call.input},{type:'response.output_item.done',output_index:0,item:call},{type:'response.completed',response}]
      return reply.type('text/event-stream').send(events.map(event=>`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
    }
    const message={id:'msg_fixture',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:answer,annotations:[]}]}
    const response={id:'resp_fixture',object:'response',created_at:1,status:'completed',output:[message],usage:{input_tokens:100,output_tokens:5,total_tokens:105}}
    const events=[{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item:{...message,status:'in_progress'}},{type:'response.output_text.delta',output_index:0,content_index:0,item_id:message.id,delta:answer},{type:'response.output_item.done',output_index:0,item:message},{type:'response.completed',response}]
    return reply.type('text/event-stream').send(events.map(event=>`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
  })
  await app.listen({host:'127.0.0.1',port:0})
  const address=app.server.address() as any
  try {
    const codex=new Codex({env:{PATH:process.env.PATH!,HOME:root,CODEX_HOME:configHome,NEWS_RUN_TOKEN:'fake-no-provider-key'},config:{model_provider:'fixture',model_providers:{fixture:{name:'fixture',base_url:`http://127.0.0.1:${address.port}/v1`,env_key:'NEWS_RUN_TOKEN',requires_openai_auth:false,wire_api:'responses',request_max_retries:0,stream_max_retries:0,supports_websockets:false}},features:{shell_tool:false},web_search:'disabled',agents:{enabled:true,max_concurrent_threads_per_session:3,default_subagent_model:'gpt-5.6-luna',default_subagent_reasoning_effort:'low'},mcp_servers:{editorial:editorialMcpConfig(`http://127.0.0.1:${address.port}/mcp`)}}})
    const thread=codex.startThread({model:'gpt-6-astra',workingDirectory:work,skipGitRepoCheck:true,approvalPolicy:'never',sandboxMode:'read-only',networkAccessEnabled:false,webSearchMode:'disabled'})
    const result=await thread.run('Read candidates, then return the requested local fixture JSON.',{signal:AbortSignal.timeout(20000),outputSchema:z.toJSONSchema(DraftReceipt,{io:'output'})})
    assert.equal(result.finalResponse,answer);assert.equal(requests.length,2);assert.equal(calls,1,JSON.stringify(requests[1].input.filter((item:any)=>item.type.endsWith('call_output'))))
    assert(JSON.stringify(requests[1].input).includes('fixture-evidence-123'))
    assert(!JSON.stringify(requests[0]).includes('publish_edition'))
    assert.deepEqual(requests[0].text.format.schema.required,['contentHash'])
    assert(upperBound({...requests[0],max_output_tokens:8000},{input:10,cacheWrite:12.5,output:50})>0)
  }finally{await app.close();await rm(root,{recursive:true,force:true,maxRetries:8,retryDelay:250})}
})
