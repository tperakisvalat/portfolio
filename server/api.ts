import Fastify from 'fastify'
import { z } from 'zod'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { Draft, Settings, Source, Topic, Topics } from '../shared/news.js'
import { safeFetch } from './fetch.js'
import { ingestSource, parseFeed } from './feeds.js'
import { audit, briefText, getSettings, hash, HttpError, latestEdition, publish, saveDraft, updateVersioned } from './store.js'
import type { Database } from './db.js'
import { readiness } from './health.js'
import { MarketLink, publicMarkets, refreshMarkets } from './markets.js'
import { getDraftQuality, qualityChecks } from './editorial-quality.js'
import { EditionRequest, queueEdition } from './editorial-assignment.js'
import { effectiveBudget, setDayAllowance } from './budget.js'
import { runMetrics } from './editorial-metrics.js'

const versioned = z.object({ expectedVersion:z.number().int().positive(),value:z.unknown() }).strict()
const uuid = z.uuid()
export interface Actor { id: string; owner: boolean; scopes: string[] }
export async function authenticate(db: Database, token: string): Promise<Actor> {
  const local = process.env.NEWS_LOCAL_ADMIN_TOKEN
  if ((process.env.NODE_ENV !== 'production' || process.env.NEWS_LOCAL_DESK==='true') && local && Buffer.byteLength(token) === Buffer.byteLength(local) && timingSafeEqual(Buffer.from(token),Buffer.from(local))) return {id:'local-owner',owner:true,scopes:['*']}
  const [service] = await db.query<any>('SELECT id,scopes FROM news_private.service_tokens WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now()',[hash(token)])
  if (service) return {id:`service:${service.id}`,owner:false,scopes:service.scopes}
  const ownerId=process.env.NEWS_OWNER_ID, base=process.env.VITE_SUPABASE_URL, apiKey=process.env.VITE_SUPABASE_ANON_KEY
  if (!ownerId || !base || !apiKey) throw new HttpError(401,'Owner authentication is not configured')
  const response=await fetch(`${base}/auth/v1/user`,{headers:{apikey:apiKey,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(5000)})
  if (!response.ok) throw new HttpError(401,'Session expired')
  const user=await response.json()
  if (user.id !== ownerId) throw new HttpError(403,'Owner access required')
  return {id:`owner:${user.id}`,owner:true,scopes:['*']}
}
export function createApi(db: Database, auth=authenticate) {
  const app=Fastify({bodyLimit:250000,logger:{level:'warn',redact:['req.headers.authorization','req.body']}})
  app.setErrorHandler((error:any,req,reply)=>{
    const status=error instanceof z.ZodError?422:error.statusCode || 500
    // Correlate failures without logging credentials, request bodies or private evidence.
    req.log.warn({requestId:req.id,method:req.method,route:req.routeOptions.url,statusCode:status,errorType:error.name},'News request failed')
    reply.code(status).send({error: status>=500?'News service unavailable':error.message, requestId:req.id, ...(error instanceof z.ZodError ? {issues:error.issues} : {})})
  })
  app.addHook('onRequest',async(req,reply)=>{
    reply.header('X-Content-Type-Options','nosniff')
    if (req.url.includes('/admin/')) reply.header('Cache-Control','no-store')
    const origin=req.headers.origin
    const allowedOrigins=[process.env.NEWS_WEB_ORIGIN,...(process.env.NODE_ENV !== 'production' ? ['http://127.0.0.1:5173','http://localhost:5173'] : [])].filter(Boolean)
    if (!['GET','HEAD'].includes(req.method) && origin && !allowedOrigins.includes(origin)) throw new HttpError(403,'Origin not allowed')
  })
  async function actor(req:any,scope:string,ownerOnly=false) {
    const token=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
    if (!token) throw new HttpError(401,'Authentication required')
    const who=await auth(db,token)
    if ((ownerOnly && !who.owner) || (!who.owner && !who.scopes.includes(scope))) throw new HttpError(403,`Permission required: ${scope}`)
    return who
  }
  const base='/api/news/v1'
  app.post(`${base}/admin/budget/allowance`,async req=>{const who=await actor(req,'budget:write',true);return setDayAllowance(db,who.id,req.body)})
  app.get(`${base}/admin/budget`,async req=>{await actor(req,'read');const {value}=await getSettings(db);return effectiveBudget(db,{targetUsd:value.targetUsd,softUsd:value.softUsd,hardUsd:value.hardUsd})})
  app.get(`${base}/health`,async()=>{await db.query('SELECT 1');return {ok:true}})
  app.get(`${base}/brief/latest`,async(_req,reply)=>{reply.header('Cache-Control','no-store');return {edition:await latestEdition(db)}})
  app.get('/news/brief.txt',async(_req,reply)=>reply.header('Cache-Control','no-store').type('text/plain; charset=utf-8').send(briefText(await latestEdition(db))))
  app.get(`${base}/editions/:id`,async(req:any)=>{
    const [edition]=await db.query<any>('SELECT id,published_at,content FROM news_private.editions WHERE id=$1',[uuid.parse(req.params.id)])
    if(!edition)throw new HttpError(404,'Edition not found');return {edition}
  })
  app.get(`${base}/library`,async(req:any)=>{
    const q=z.object({topic:Topic.optional(),offset:z.coerce.number().int().min(0).max(10000).default(0)}).parse(req.query)
    const items=await db.query<any>(`SELECT i.id,i.title,i.canonical_url AS url,i.author,i.published_at,i.kind,s.config->>'name' AS publisher,l.annotation
      FROM news_private.library l JOIN news_private.items i ON i.id=l.item_id JOIN news_private.sources s ON s.id=i.source_id
      WHERE ($1::text IS NULL OR EXISTS(SELECT 1 FROM news_private.library_topics t WHERE t.item_id=i.id AND t.topic=$1))
      ORDER BY i.published_at DESC NULLS LAST,i.id DESC LIMIT 31 OFFSET $2`,[q.topic || null,q.offset])
    return {items:items.slice(0,30),nextOffset:items.length>30?q.offset+30:null}
  })
  app.get(`${base}/markets`,async(req:any)=>publicMarkets(db,Topic.optional().parse(req.query.topic)))
  app.get(`${base}/admin/readiness`,async(req:any)=>{await actor(req,'read',true);return readiness(db,req.query.account==='true')})
  app.get(`${base}/admin/runs/:id`,async(req:any)=>{
    await actor(req,'read');const id=uuid.parse(req.params.id)
    const [run]=await db.query('SELECT id,status,draft_id,error,created_at,finished_at FROM news_private.runs WHERE id=$1',[id]);if(!run)throw new HttpError(404,'Run not found')
    const editorial=await db.query("SELECT action,after_value AS record,created_at FROM news_private.audit WHERE entity_id=$1 AND action IN ('editor.plan','editor.review','editor.research_rejected') ORDER BY created_at DESC,id DESC LIMIT 12",[id])
    const [assignment]=await db.query<any>("SELECT after_value FROM news_private.audit WHERE entity_id=$1 AND action IN ('run.assignment','run.experiment') ORDER BY created_at DESC,id DESC LIMIT 1",[id])
    const value=assignment?.after_value
    // Expose the commission, not embedded draft copies or calibration answer keys.
    const commission=value?Object.fromEntries(['kind','variant','model','note','draftId','version','source','limitations'].filter(key=>value[key]!==undefined).map(key=>[key,value[key]])):null
    return {...run,commission,editorial,metrics:await runMetrics(db,id)}
  })
  app.get(`${base}/admin/research`,async req=>{await actor(req,'read');return db.query('SELECT id,run_id,query,report,sources,created_at FROM news_private.research ORDER BY created_at DESC LIMIT 100')})
  app.get(`${base}/admin/research/:id`,async(req:any)=>{await actor(req,'read');const [row]=await db.query('SELECT id,query,report,sources,created_at FROM news_private.research WHERE id=$1',[uuid.parse(req.params.id)]);if(!row)throw new HttpError(404,'Research report not found');return row})
  app.get(`${base}/admin/tokens`,async req=>{await actor(req,'tokens:write',true);return db.query('SELECT id,name,scopes,expires_at,revoked_at FROM news_private.service_tokens ORDER BY expires_at DESC')})
  app.post(`${base}/admin/tokens`,async req=>{
    const who=await actor(req,'tokens:write',true),body=z.object({name:z.string().min(2).max(100)}).strict().parse(req.body),token=randomBytes(32).toString('base64url')
    const [row]=await db.query<any>("INSERT INTO news_private.service_tokens(id,name,token_hash,scopes,expires_at) VALUES($1,$2,$3,$4,now()+interval '90 days') RETURNING id,name,scopes,expires_at",[randomUUID(),body.name,hash(token),['read','settings:write','sources:write','drafts:write']])
    await audit(db,who.id,'token.create',row.id,null,{name:row.name,scopes:row.scopes});return {...row,token}
  })
  app.post(`${base}/admin/tokens/:id/revoke`,async(req:any)=>{const who=await actor(req,'tokens:write',true),id=uuid.parse(req.params.id);await db.query('UPDATE news_private.service_tokens SET revoked_at=now() WHERE id=$1',[id]);await audit(db,who.id,'token.revoke',id,null,null);return {revoked:true}})
  app.get(`${base}/admin/items/:id`,async(req:any)=>{await actor(req,'read');const [item]=await db.query('SELECT * FROM news_private.items WHERE id=$1',[uuid.parse(req.params.id)]);if(!item)throw new HttpError(404,'Item not found');return item})
  app.get(`${base}/admin/feedback`,async req=>{await actor(req,'read');return db.query('SELECT * FROM news_private.feedback ORDER BY created_at DESC LIMIT 50')})
  app.post(`${base}/admin/feedback`,async req=>{const who=await actor(req,'settings:write'),body=z.object({text:z.string().min(5).max(8000)}).strict().parse(req.body);const [row]=await db.query('INSERT INTO news_private.feedback(id,text,actor) VALUES($1,$2,$3) RETURNING *',[randomUUID(),body.text,who.id]);return row})
  app.get(`${base}/admin/markets`,async req=>{await actor(req,'read');return db.query('SELECT * FROM news_private.market_links ORDER BY topic,id')})
  app.post(`${base}/admin/markets`,async req=>{const who=await actor(req,'markets:write',true),value=MarketLink.parse(req.body);const [row]=await db.query('INSERT INTO news_private.market_links(id,provider,external_id,topic,enabled,permission_reference,public_url) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[randomUUID(),value.provider,value.externalId,value.topic,value.enabled,value.permissionReference,value.url]);await audit(db,who.id,'market.create',(row as any).id,null,value);return row})
  app.put(`${base}/admin/markets/:id`,async(req:any)=>{
    const who=await actor(req,'markets:write',true),body=versioned.parse(req.body),value=MarketLink.parse(body.value)
    return db.transaction(async tx=>{const [old]=await tx.query<any>('SELECT * FROM news_private.market_links WHERE id=$1 FOR UPDATE',[uuid.parse(req.params.id)]);if(!old)throw new HttpError(404,'Market link not found');if(old.version!==body.expectedVersion)throw new HttpError(409,'Market link changed');const [row]=await tx.query('UPDATE news_private.market_links SET provider=$2,external_id=$3,topic=$4,enabled=$5,permission_reference=$6,public_url=$7,selected=$5,version=version+1,quote=NULL,checked_at=NULL WHERE id=$1 RETURNING *',[old.id,value.provider,value.externalId,value.topic,value.enabled,value.permissionReference,value.url]);await audit(tx,who.id,'market.update',old.id,old,row);return row})
  })
  app.post(`${base}/admin/markets/refresh`,async req=>{await actor(req,'markets:write',true);await refreshMarkets(db);return {ok:true}})
  app.get(`${base}/admin/schema`,async req=>{
    await actor(req,'read')
    return {version:1,topics:Topics,source:z.toJSONSchema(Source),settings:z.toJSONSchema(Settings),draft:z.toJSONSchema(Draft),editionRequest:z.toJSONSchema(EditionRequest),mutations:'Use expectedVersion for edits; publication requires owner + Idempotency-Key. POST /admin/runs accepts {} for a new edition or a revision commission referencing an exact draft version; both are paid, owner-only, private-draft operations. Editor and assistant tokens cannot publish, start paid runs or change budgets.'}
  })
  app.get(`${base}/admin/overview`,async req=>{
    await actor(req,'read')
    const [settings,sources,drafts,items,runs,usage]=await Promise.all([
      getSettings(db), db.query('SELECT * FROM news_private.sources ORDER BY id'),
      db.query('SELECT * FROM news_private.drafts ORDER BY created_at DESC LIMIT 30'),
      db.query('SELECT i.*,s.config->>\'name\' AS publisher FROM news_private.items i JOIN news_private.sources s ON s.id=i.source_id ORDER BY i.discovered_at DESC LIMIT 100'),
      db.query('SELECT id,status,draft_id,error,created_at,started_at,finished_at FROM news_private.runs ORDER BY created_at DESC LIMIT 30'),
      db.query('SELECT * FROM news_private.daily_budget ORDER BY day DESC LIMIT 14'),
    ])
    const reviewedDrafts=await Promise.all(drafts.map(async(row:any)=>({...row,quality:await getDraftQuality(db,row.id,Draft.parse(row.content)),checks:qualityChecks(Draft.parse(row.content),settings.value)})))
    return {settings,sources,drafts:reviewedDrafts,items,runs,usage,runtime:{apiKeyConfigured:!!process.env.OPENAI_API_KEY,workerConfigured:process.env.NEWS_WORKER_ENABLED==='true',database:process.env.DATABASE_URL?'postgres':'local'}}
  })
  app.put(`${base}/admin/settings`,async(req:any)=>{
    const who=await actor(req,'settings:write'),body=versioned.parse(req.body),next=Settings.parse(body.value)
    if(!who.owner){const current=(await getSettings(db)).value;for(const key of ['hardUsd','softUsd','targetUsd','mainModel','helperModel','researchModel','reviewModel','schedule','searchEnabled'] as const)if(JSON.stringify(next[key])!==JSON.stringify(current[key]))throw new HttpError(403,'Only owner can change models, budgets, scheduling or search')}
    return updateVersioned(db,who.id,'settings','editor',body.expectedVersion,next)
  })
  app.post(`${base}/admin/sources`,async(req:any)=>{
    const who=await actor(req,'sources:write',true),source=Source.parse(req.body)
    return db.transaction(async tx=>{const [row]=await tx.query('INSERT INTO news_private.sources(id,config) VALUES($1,$2) RETURNING *',[source.id,JSON.stringify(source)]);await audit(tx,who.id,'source.create',source.id,null,row);return row})
  })
  app.put(`${base}/admin/sources/:id`,async(req:any)=>{
    const who=await actor(req,'sources:write'),body=versioned.parse(req.body),next=Source.parse(body.value)
    if(!who.owner){const [old]=await db.query<any>('SELECT config FROM news_private.sources WHERE id=$1',[req.params.id]);if(!old)throw new HttpError(404,'Source not found');for(const key of ['endpoint','enabled','processing','adapter','rightsNote','rightsUrl','recommendation'] as const)if(next[key]!==old.config[key])throw new HttpError(403,'Only owner can change access or processing permissions')}
    return updateVersioned(db,who.id,'sources',req.params.id,body.expectedVersion,next)
  })
  app.post(`${base}/admin/sources/:id/:action`,async(req:any)=>{
    await actor(req,'sources:ingest',true)
    const action=z.enum(['preview','ingest']).parse(req.params.action)
    const [row]=await db.query<any>('SELECT config FROM news_private.sources WHERE id=$1',[req.params.id])
    if(!row)throw new HttpError(404,'Source not found')
    const source=Source.parse(row.config)
    if(!source.endpoint || source.adapter!=='feed' || source.recommendation==='hold')throw new HttpError(422,'Connector or access review required')
    if(action==='ingest')return ingestSource(db,source)
    const xml=await safeFetch(source.endpoint,[new URL(source.endpoint).hostname])
    return {items:parseFeed(xml,{...source,processing:'metadata'}).slice(0,10),note:'Preview only; not stored. Working access does not establish processing rights.'}
  })
  app.post(`${base}/admin/drafts/validate`,async(req:any)=>{await actor(req,'drafts:write');const {validateEvidence}=await import('./store.js');await validateEvidence(db,Draft.parse(req.body));return {valid:true}})
  app.post(`${base}/admin/drafts`,async(req:any)=>{const who=await actor(req,'drafts:write');return saveDraft(db,who.id,req.body)})
  app.put(`${base}/admin/drafts/:id`,async(req:any)=>{const who=await actor(req,'drafts:write'),body=versioned.parse(req.body);return saveDraft(db,who.id,body.value,uuid.parse(req.params.id),body.expectedVersion)})
  app.post(`${base}/admin/drafts/:id/publish`,async(req:any)=>{
    const who=await actor(req,'publish',true),body=z.object({expectedVersion:z.number().int().positive()}).strict().parse(req.body)
    const key=z.string().min(8).max(150).parse(req.headers['idempotency-key'])
    return publish(db,who.id,uuid.parse(req.params.id),body.expectedVersion,key)
  })
  app.post(`${base}/admin/runs`,async req=>{
    const who=await actor(req,'runs:create',true)
    if(process.env.NEWS_WORKER_ENABLED!=='true')throw new HttpError(503,'Worker is not connected; no paid run was started')
    if(!process.env.OPENAI_API_KEY)throw new HttpError(503,'OpenAI key is missing; no paid run was started')
    const ready=await readiness(db)
    if(!ready.ready)throw new HttpError(503,'Required connections are missing. Check the connections panel; no run was queued.')
    return queueEdition(db,who.id,req.body||{})
  })
  app.post(`${base}/admin/runs/:id/cancel`,async(req:any)=>{
    const who=await actor(req,'runs:cancel',true),id=uuid.parse(req.params.id)
    await db.query("UPDATE news_private.runs SET status='cancelled',finished_at=now() WHERE id=$1 AND status IN ('queued','running')",[id]);await audit(db,who.id,'run.cancel',id,null,null);return {cancelled:true}
  })
  return app
}
