// Isolated packaging smoke test. No host ports, real credentials, publisher/model
// access, existing containers or desk volumes. Requires an explicitly built image.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const image=process.argv[2]
if(!image || !/^tpv-news-audit:[a-zA-Z0-9._-]+$/.test(image))throw new Error('Provide an explicit tpv-news-audit:<tag> image. This never tests or restarts the live desk.')
const label='tpv.news.packaging-test',containers=[]
let network
function docker(args) {
  const result=spawnSync('docker',args,{encoding:'utf8',timeout:30000})
  if(result.error || result.status!==0)throw new Error(`Docker packaging check failed (${args[0]}); no existing desk targeted.`)
  return result.stdout.trim()
}
function remember(id){assert.match(id,/^[a-f0-9]{64}$/);containers.push(id);return id}
async function waitUntil(check,description) {
  for(let i=0;i<60;i++){if(check())return;await delay(500)}
  throw new Error(`Disposable ${description} did not become ready`)
}
try {
  docker(['image','inspect',image])
  network=docker(['network','create','--internal','--label',`${label}=true`,`tpv-news-audit-${randomUUID()}`])
  assert.match(network,/^[a-f0-9]{64}$/)
  const password=randomBytes(24).toString('hex')
  const db=remember(docker(['run','--detach','--label',`${label}=true`,'--network',network,'--network-alias','db',
    '--tmpfs','/var/lib/postgresql/data:rw,size=256m','--env','POSTGRES_DB=news','--env','POSTGRES_USER=news',
    '--env',`POSTGRES_PASSWORD=${password}`,'postgres:17-bookworm']))
  await waitUntil(()=>spawnSync('docker',['exec',db,'pg_isready','-h','127.0.0.1','-U','news','-d','news'],{stdio:'ignore',timeout:3000}).status===0,'database')
  const desk=remember(docker(['run','--detach','--label',`${label}=true`,'--network',network,'--read-only',
    '--tmpfs','/tmp:rw,size=64m,mode=1777','--cap-drop','ALL','--security-opt','no-new-privileges:true',
    '--env',`DATABASE_URL=postgres://news:${password}@db:5432/news`,'--env','NEWS_MANAGED_DB=local-compose',
    '--env','NEWS_LOCAL_DESK=false','--env','NEWS_WORKER_ENABLED=false','--env','NEWS_WEB_ORIGIN=https://tpv.world',image]))
  // This health request is wholly inside the synthetic, disconnected container.
  // It does not target localhost:8080 on the user's Mac or any browser surface.
  const healthy=()=>spawnSync('docker',['exec',desk,'node','-e',"fetch('http://127.0.0.1:8080/api/news/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"],{stdio:'ignore',timeout:3000}).status===0
  await waitUntil(healthy,'news desk')
  assert.equal(docker(['exec',desk,'id','-u']),'1000')
  const query=code=>JSON.parse(docker(['exec',desk,'node','--import','tsx','--input-type=module','-e',`import {openDatabase} from './server/db.ts';const db=await openDatabase();try{${code}}finally{await db.close()}`]))
  const read="const [row]=await db.query(\"SELECT (SELECT count(*)::int FROM news_private.runs) AS runs,(SELECT count(*)::int FROM news_private.items) AS items,(SELECT count(*)::int FROM news_private.usage) AS usage,(SELECT count(*)::int FROM news_private.sources) AS sources,(SELECT value->>'priorities' FROM news_private.settings WHERE id='editor') AS priorities\");console.log(JSON.stringify(row))"
  const first=query(read)
  assert(first.sources>=50);assert.equal(first.runs,0);assert.equal(first.items,0);assert.equal(first.usage,0)
  query("await db.query(\"UPDATE news_private.settings SET value=jsonb_set(value,'{priorities}',to_jsonb('packaging-test-survives-restart'::text)) WHERE id='editor'\");console.log('null')")
  docker(['restart',desk]);await waitUntil(healthy,'restarted desk')
  const after=query(read)
  assert.equal(after.priorities,'packaging-test-survives-restart');assert.equal(after.sources,first.sources)
  assert.equal(after.runs,0);assert.equal(after.items,0);assert.equal(after.usage,0)
  const responses=JSON.parse(docker(['exec',desk,'node','--input-type=module','-e',
    "const read=async path=>{const r=await fetch('http://127.0.0.1:8080'+path);return {status:r.status,cache:r.headers.get('cache-control'),body:await r.text()}};console.log(JSON.stringify({brief:await read('/api/news/v1/brief/latest'),admin:await read('/api/news/v1/admin/overview')}))"]))
  assert.equal(responses.brief.status,200);assert.equal(responses.brief.cache,'no-store');assert.equal(JSON.parse(responses.brief.body).edition,null)
  assert.equal(responses.admin.status,401)
  console.log('PASS / production image boots read-only without provider access; disabled worker stays idle, restart preserves settings, private API rejects anonymous access.')
} finally {
  for(const id of containers.reverse())if(docker(['inspect','--format',`{{index .Config.Labels "${label}"}}`,id])==='true')docker(['rm','--force','--volumes',id])
  if(network && /^[a-f0-9]{64}$/.test(network) && docker(['network','inspect','--format',`{{index .Labels "${label}"}}`,network])==='true')docker(['network','rm',network])
  console.log('Removed only disposable packaging containers and their isolated network. No live desk changes.')
}
