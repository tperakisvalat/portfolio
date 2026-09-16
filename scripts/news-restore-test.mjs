// Restore a private SQL checkpoint ONLY into a newly created disposable database.
// Does not connect to the running news desk, enable workers, or call providers.
import {spawn,spawnSync} from 'node:child_process'
import {createReadStream} from 'node:fs'
import {lstat,realpath} from 'node:fs/promises'
import {resolve,dirname,basename} from 'node:path'
import {randomBytes,randomUUID} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
import {openDatabase} from '../server/db.ts'
import {Draft} from '../shared/news.ts'
import {draftHash} from '../server/editorial-quality.ts'
import {briefText} from '../server/store.ts'

const label='tpv.news.restore-test'
function docker(args){const r=spawnSync('docker',args,{encoding:'utf8',timeout:30000});if(r.error||r.status!==0)throw new Error('Docker restore-test operation failed; no live database was targeted.');return r.stdout.trim()}
let container,db
try{
  if(!process.argv[2])throw new Error('Provide one .local/backups/news-*.sql checkpoint path.')
  const path=resolve(process.argv[2]),root=await realpath('.local/backups'),info=await lstat(path)
  if(!info.isFile()||info.isSymbolicLink()||dirname(await realpath(path))!==root||!/^news-[\w-]+\.sql$/.test(basename(path)))throw new Error('Expected a regular checkpoint directly inside .local/backups.')
  const password=randomBytes(24).toString('hex')
  container=docker(['run','--detach','--name',`tpv-news-restore-${randomUUID()}`,'--label',`${label}=true`,'--publish','127.0.0.1::5432','--tmpfs','/var/lib/postgresql/data:rw,size=512m','--env','POSTGRES_DB=news_restore_test','--env',`POSTGRES_PASSWORD=${password}`,'postgres:17-bookworm'])
  if(!/^[a-f0-9]{64}$/.test(container))throw new Error('Unexpected disposable container ID')
  let ready=false
  for(let attempt=0;attempt<40;attempt++){if(spawnSync('docker',['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres','-d','news_restore_test'],{stdio:'ignore',timeout:3000}).status===0){ready=true;break}await delay(500)}
  if(!ready)throw new Error('Disposable restore database did not become ready')
  const code=await new Promise((done,reject)=>{
    const child=spawn('docker',['exec','-i',container,'psql','-X','-q','--set','ON_ERROR_STOP=on','-U','postgres','-d','news_restore_test'],{stdio:['pipe','ignore','ignore']})
    const stream=createReadStream(path);stream.on('error',reject);child.on('error',reject);child.stdin.on('error',()=>{});stream.pipe(child.stdin);child.on('close',value=>{stream.destroy();done(value)})
  })
  if(code!==0)throw new Error('SQL restore failed. Private SQL/error data was not printed.')
  const port=docker(['inspect','--format','{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',container])
  if(!/^\d+$/.test(port))throw new Error('Invalid disposable test port')
  db=await openDatabase(`postgres://postgres:${password}@127.0.0.1:${port}/news_restore_test`)
  const drafts=await db.query('SELECT content FROM news_private.drafts'),editions=await db.query('SELECT content,published_at FROM news_private.editions')
  for(const d of drafts){const parsed=Draft.parse(d.content);if(draftHash(parsed)!==draftHash(d.content))throw new Error('Restored draft is not schema-compatible')}
  for(const e of editions)if(!briefText(e).trim())throw new Error('Restored public edition has an empty text export')
  const [sources]=await db.query('SELECT count(*) AS count FROM news_private.sources')
  const [security]=await db.query("SELECT count(*) FILTER (WHERE NOT c.relrowsecurity) AS unprotected FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='news_private' AND c.relkind='r' AND c.relname<>'migrations'")
  if(Number(security.unprotected)!==0)throw new Error('Restored private table missing row-level security')
  console.log(JSON.stringify({result:'restored and validated',checkpoint:basename(path),drafts:drafts.length,editions:editions.length,sources:Number(sources.count),privateTableRls:true,liveDeskTouched:false,providerCalls:0}))
}catch(error){console.error(error.message);process.exitCode=1}
finally{
  await db?.close()
  if(container&&/^[a-f0-9]{64}$/.test(container)&&docker(['inspect','--format',`{{index .Config.Labels "${label}"}}`,container])==='true'){
    docker(['rm','--force','--volumes',container]);console.log('Removed only the disposable restore container. Original backup and news desk are unchanged.')
  }
}
