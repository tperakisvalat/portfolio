import { openDatabase, migrate } from './db.js'
import { seed } from './seed.js'
import { createApi } from './api.js'
import { randomBytes, randomUUID } from 'node:crypto'
import { hash } from './store.js'

const db=await openDatabase()
const command=process.argv[2]
if(command==='init') {
  if(process.env.DATABASE_URL)throw new Error('Remote initialization is intentionally disabled here. Apply the reviewed migration and seed explicitly after target approval.')
  await migrate(db);await seed(db);await db.close();console.log('Local news database initialized; existing settings preserved.')
} else if(command==='serve') {
  const api=createApi(db)
  // Never expose a local admin token through a network-bound development server.
  await api.listen({host:'127.0.0.1',port:Number(process.env.NEWS_API_PORT || 8787)})
  console.log('News API: http://127.0.0.1:8787')
  const stop=async()=>{await api.close();await db.close()}
  process.once('SIGTERM',()=>void stop());process.once('SIGINT',()=>void stop())
} else if(command==='token') {
  const name=process.argv[3] || 'personal-assistant',token=randomBytes(32).toString('base64url')
  await db.query("INSERT INTO news_private.service_tokens(id,name,token_hash,scopes,expires_at) VALUES($1,$2,$3,$4,now()+interval '90 days')",[randomUUID(),name,hash(token),['read','settings:write','drafts:write','sources:write']])
  console.log('Store this token securely; it is shown once:\n'+token);await db.close()
} else { await db.close();throw new Error('Use init, serve, or token') }
