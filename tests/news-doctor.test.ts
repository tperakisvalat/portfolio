import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { runDoctor } from '../server/doctor-client.js'

test('doctor queues exactly once over real HTTP with a valid JSON body, then reports a saved draft',async()=>{
  const app=Fastify(),logs:string[]=[],requests:string[]=[]
  app.addHook('onRequest',async req=>{requests.push(`${req.method} ${req.url}`);assert.equal(req.headers.authorization,'Bearer fixture-token')})
  app.get('/readiness',async req=>{assert.equal(req.headers['content-type'],undefined);return {ready:true,checks:[]}})
  app.post('/runs',async req=>{assert.equal(req.headers['content-type'],'application/json');assert.deepEqual(req.body,{});return {id:'fixture-run',status:'queued'}})
  app.get('/runs/fixture-run',async()=>({status:'review',draft_id:'fixture-draft'}))
  const base=await app.listen({host:'127.0.0.1',port:0})
  try {
    await runDoctor({base,token:'fixture-token',paidRun:true,log:line=>logs.push(line)})
    assert.deepEqual(requests,['GET /readiness','POST /runs','GET /runs/fixture-run'])
    assert(logs.some(line=>line.includes('PASS / real draft saved: fixture-draft')))
    assert(!logs.join('\n').includes('fixture-token'))
  }finally{await app.close()}
})

test('doctor surfaces queue errors, redacts keys, and never retries a rejected submission',async()=>{
  const app=Fastify();let submissions=0
  app.get('/readiness',async()=>({ready:true,checks:[]}))
  app.post('/runs',async(_req,reply)=>{submissions++;return reply.code(400).send({error:'Fixture rejected for fixture-token sk-fake-provider-secret'})})
  const base=await app.listen({host:'127.0.0.1',port:0})
  try {
    await assert.rejects(()=>runDoctor({base,token:'fixture-token',paidRun:true,log:()=>{}}),error=>{
      assert(error instanceof Error);assert.match(error.message,/Could not queue run \(400\): Fixture rejected/)
      assert(!error.message.includes('fixture-token'));assert(!error.message.includes('sk-fake-provider-secret'));return true
    })
    assert.equal(submissions,1)
  }finally{await app.close()}
})

test('doctor readiness-only and failed readiness never queue runs',async()=>{
  const app=Fastify();let ready=true,submissions=0
  app.get('/readiness',async()=>({ready,checks:[]}))
  app.post('/runs',async()=>{submissions++;return {id:'unexpected'}})
  const base=await app.listen({host:'127.0.0.1',port:0})
  try {
    await runDoctor({base,token:'fixture-token',log:()=>{}})
    ready=false
    await assert.rejects(()=>runDoctor({base,token:'fixture-token',paidRun:true,log:()=>{}}),/Resolve required checks/)
    assert.equal(submissions,0)
  }finally{await app.close()}
})

test('doctor reports polling failures with the existing run ID without starting another run',async()=>{
  const app=Fastify();let submissions=0
  app.get('/readiness',async()=>({ready:true,checks:[]}))
  app.post('/runs',async()=>{submissions++;return {id:'existing-run'}})
  app.get('/runs/existing-run',async(_req,reply)=>reply.code(503).send({error:'Temporary service failure'}))
  const base=await app.listen({host:'127.0.0.1',port:0})
  try {
    await assert.rejects(()=>runDoctor({base,token:'fixture-token',paidRun:true,log:()=>{}}),/Could not check run existing-run.*503.*Temporary service failure/)
    assert.equal(submissions,1)
  }finally{await app.close()}
})
