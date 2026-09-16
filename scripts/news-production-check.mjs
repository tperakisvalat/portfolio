// Render configuration only: never create services, read local credentials, or
// contact a model. Compose's own merger catches differences YAML inspection misses.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const env={...process.env}
for(const key of Object.keys(env))if(/^(NEWS_|VITE_|OPENAI_|DATABASE_URL$)/.test(key))delete env[key]
Object.assign(env,{
  NEWS_DB_PASSWORD:'fixture-not-a-secret',NEWS_LOCAL_ADMIN_TOKEN:'fixture-local-key',NEWS_EXECUTOR_TOKEN:'fixture-executor-key',
  NEWS_OWNER_ID:'00000000-0000-4000-8000-000000000001',VITE_SUPABASE_URL:'https://fixture.supabase.co',
  VITE_SUPABASE_ANON_KEY:'fixture-public-key',NEWS_WEB_ORIGIN:'https://tpv.world',NEWS_BACKEND_DOMAIN:'news-api.example.org',
})
function render(production,worker) {
  const fixture={...env,...(worker===undefined?{}:{NEWS_WORKER_ENABLED:worker})}
  const args=['compose','--env-file','/dev/null','-f','compose.news.yaml',...(production?['-f','compose.news.production.yaml']:[]),'config','--format','json']
  const result=spawnSync('docker',args,{env:fixture,encoding:'utf8',timeout:30000})
  assert.equal(result.status,0,'Docker Compose must render the synthetic configuration')
  return JSON.parse(result.stdout)
}
const local=render(false),production=render(true),enabled=render(true,'true')
assert.equal(local.services.desk.environment.NEWS_WORKER_ENABLED,'true')
assert.equal(production.services.desk.environment.NEWS_WORKER_ENABLED,'false')
assert.equal(enabled.services.desk.environment.NEWS_WORKER_ENABLED,'true')
assert.equal(production.services.desk.environment.NEWS_LOCAL_DESK,'false')
assert.equal(production.services.desk.environment.NEWS_LOCAL_ADMIN_TOKEN,'')
assert.equal(production.services.desk.build.args.VITE_NEWS_LOCAL_DESK,'false')
for(const name of ['db','executor'])assert.equal(production.services[name].ports,undefined,`${name} must never expose a host port`)
assert(production.services.desk.ports.every(p=>p.host_ip==='127.0.0.1'))
assert.deepEqual(Object.keys(production.services.executor.networks),['agent'])
assert.equal(production.networks.agent.internal,true)
assert.equal(production.networks.database.internal,true)
for(const name of ['desk','executor']) {
  const service=production.services[name]
  assert.equal(service.read_only,true)
  assert(service.cap_drop.includes('ALL'));assert(service.security_opt.includes('no-new-privileges:true'))
}
assert.deepEqual(Object.keys(production.services.executor.environment),['NEWS_EXECUTOR_TOKEN'])
assert.equal(production.services.executor.volumes,undefined)
assert(production.services.db.volumes.some(v=>v.type==='volume'&&v.target==='/var/lib/postgresql/data'))
assert(production.services.https.volumes.some(v=>v.type==='volume'&&v.target==='/data'))
const frontend=JSON.parse(await readFile('vercel.json','utf8'))
assert.equal(frontend.rewrites[0].source,'/news/brief.txt')
assert.equal(frontend.rewrites[1].source,'/api/news/:path*')
assert.equal(frontend.rewrites.at(-1).source,'/(.*)')
console.log('PASS / production configuration: worker off by default, owner auth, private database/executor, persistent volumes, scoped frontend routing.')
console.log('No services started, credentials loaded, DNS changed, or provider calls made.')
