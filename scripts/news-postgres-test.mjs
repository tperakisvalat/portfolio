// Real driver parity tests on a disposable database, never the news desk's volume.
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

function docker(args) {
  const result=spawnSync('docker',args,{encoding:'utf8',timeout:30000})
  if(result.error || result.status!==0)throw new Error(result.error?.message || result.stderr || 'Docker command failed')
  return result.stdout.trim()
}
let container
try {
  const password=randomBytes(24).toString('hex')
  container=docker(['run','--detach','--name',`tpv-news-test-${randomUUID()}`,
    '--label','tpv.news.disposable-test=true','--publish','127.0.0.1::5432',
    '--tmpfs','/var/lib/postgresql/data:rw,size=256m',
    '--env','POSTGRES_DB=news_test','--env',`POSTGRES_PASSWORD=${password}`,'postgres:17-bookworm'])
  if(!/^[a-f0-9]{64}$/.test(container))throw new Error('Unexpected Docker container ID')
  let ready=false
  for(let attempt=0;attempt<40;attempt++) {
    if(spawnSync('docker',['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres','-d','news_test'],{stdio:'ignore',timeout:3000}).status===0){ready=true;break}
    await delay(500)
  }
  if(!ready)throw new Error('Disposable PostgreSQL did not become ready')
  const port=docker(['inspect','--format','{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',container])
  if(!/^\d+$/.test(port))throw new Error('Invalid test port')
  console.log('Testing real PostgreSQL on a disposable database. No provider calls or desk data changes.')
  process.exitCode=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--import','tsx','--test','tests/news.test.ts'],{
      stdio:'inherit',env:{...process.env,NEWS_TEST_DATABASE_URL:`postgres://postgres:${password}@127.0.0.1:${port}/news_test`},
    })
    child.on('error',reject);child.on('exit',code=>resolve(code??1))
  })
}catch(error){console.error(error.message);process.exitCode=1}
finally {
  if(container && /^[a-f0-9]{64}$/.test(container)) {
    if(docker(['inspect','--format','{{index .Config.Labels "tpv.news.disposable-test"}}',container])==='true') {
      docker(['rm','--force','--volumes',container])
      console.log('Disposable test container removed; the news desk database was not touched.')
    }
  }
}
