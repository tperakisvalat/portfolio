import { resolve } from 'node:path'
import fastifyStatic from '@fastify/static'
import { openDatabase, migrate } from './db.js'
import { seed } from './seed.js'
import { createApi } from './api.js'
import { workerLoop } from './worker.js'
import { activateStarterSources } from './starter.js'

// Only the generated, private Compose database is bootstrapped automatically.
// Never turn this entry point into an implicit migration of the portfolio database.
const target=new URL(process.env.DATABASE_URL || 'http://invalid')
if(process.env.NEWS_MANAGED_DB!=='local-compose' || target.hostname!=='db' || target.pathname!=='/news')throw new Error('Managed stack requires its own private database named news on db')
const db=await openDatabase(),controller=new AbortController()
await migrate(db);await seed(db);await activateStarterSources(db)
const app=createApi(db)
await app.register(fastifyStatic,{root:resolve('dist'),wildcard:false,index:false,dotfiles:'deny',list:false})
app.setNotFoundHandler((req,reply)=>{
  if(req.method!=='GET' || req.url.startsWith('/api/') || req.url.includes('.'))return reply.code(404).send({error:'Not found'})
  return reply.header('Cache-Control','no-cache').sendFile('index.html')
})
await app.listen({host:'0.0.0.0',port:8080})
const worker=workerLoop(db,controller.signal)
let stopping=false
async function stop(){if(stopping)return;stopping=true;controller.abort();await worker;await app.close();await db.close()}
process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop())
console.log('News desk listening on port 8080. Publication remains owner-approved.')
