import { readFile, writeFile, mkdir, chmod, lstat } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { parseEnv } from 'node:util'
import { spawnSync, spawn } from 'node:child_process'
import { resolve } from 'node:path'

const command=process.argv[2]||'setup'
const credentials=resolve('.env.news.local'),generated=resolve('.local/news.generated.env')
async function readEnv(path){try{return parseEnv(await readFile(path,'utf8'))}catch(error){if(error.code==='ENOENT')return {};throw error}}
async function privateFile(path,contents) {
  try{if((await lstat(path)).isSymbolicLink())throw new Error(`Refusing symlink: ${path}`);return false}catch(error){if(error.code!=='ENOENT')throw error}
  await writeFile(path,contents,{mode:0o600,flag:'wx'});return true
}
async function setup() {
  await mkdir('.local',{recursive:true,mode:0o700})
  const existing=await readEnv('.env.local')
  let template=await readFile('config/news.env.example','utf8')
  for(const key of ['OPENAI_API_KEY','VITE_SUPABASE_URL','VITE_SUPABASE_ANON_KEY'])if(existing[key])template=template.replace(`${key}=""`,`${key}=${JSON.stringify(existing[key])}`)
  await privateFile(credentials,template)
  const values=Object.fromEntries(['NEWS_DB_PASSWORD','NEWS_LOCAL_ADMIN_TOKEN','NEWS_EXECUTOR_TOKEN'].map(key=>[key,randomBytes(32).toString('base64url')]))
  await privateFile(generated,Object.entries(values).map(([key,value])=>`${key}=${value}`).join('\n')+'\n')
  const saved=await readEnv(generated)
  if(Object.keys(values).some(key=>!saved[key]))throw new Error('Generated environment is incomplete; restore your setup backup instead of rotating the database password')
  await privateFile('.local/news-access.txt',`Local news desk\nhttp://127.0.0.1:8080/admin\n\nDesk key (paste into “local news desk”):\n${saved.NEWS_LOCAL_ADMIN_TOKEN}\n\nKeep this file private. It grants owner access to the local news database only.\n`)
  await privateFile('.local/news-pricing.json',await readFile('docs/news/pricing.example.json','utf8'))
  // Public rate metadata is bind-mounted into a non-root Linux container.
  // A root-owned 0600 file works differently on Docker Desktop and is unreadable
  // to UID 1000 on the production host. Credentials above remain 0600.
  await chmod('.local/news-pricing.json',0o644)
  await chmod(credentials,0o600);await chmod(generated,0o600)
}
function dockerReady(){return spawnSync('docker',['info','--format','{{.ServerVersion}}'],{stdio:'pipe',timeout:10000}).status===0}
const compose=['compose','--env-file',credentials,'--env-file',generated,'-f','compose.news.yaml']
async function run(args){return new Promise((resolve,reject)=>{const child=spawn('docker',[...compose,...args],{stdio:'inherit'});child.on('error',reject);child.on('exit',code=>resolve(code??1))})}
try {
  await setup()
  if(command==='prices') {
    const response=await fetch('https://developers.openai.com/api/docs/pricing.md',{signal:AbortSignal.timeout(15000)})
    if(!response.ok)throw new Error('Could not verify official pricing')
    const md=(await response.text()).split('### Standard pricing data')[1]?.split('Batch')[0]
    if(!md)throw new Error('Official pricing format changed; do not guess rates')
    const models={}
    for(const model of ['gpt-6-astra','gpt-5.6-luna','gpt-5.6-terra']) {
      const line=md.split('\n').find(line=>line.startsWith(`| ${model} |`))
      const numbers=line?.match(/\$[\d.]+/g)?.map(n=>Number(n.slice(1)))
      if(!numbers||numbers.length!==8||numbers.some(n=>!Number.isFinite(n)||n<0))throw new Error(`Cannot parse official prices for ${model}`)
      models[model]={input:numbers[0],cachedInput:numbers[1],cacheWrite:numbers[2],output:numbers[3]}
    }
    await writeFile('.local/news-pricing.json',JSON.stringify({checkedAt:new Date().toISOString().slice(0,10),models},null,2)+'\n',{mode:0o644})
    await chmod('.local/news-pricing.json',0o644)
    console.log('Current standard prices saved from official documentation. No model calls made.')
  }else if(command==='setup') {
    console.log(`Ready to edit: ${credentials}\nOnly OPENAI_API_KEY is required. Existing values were preserved.\nDesk login: ${resolve('.local/news-access.txt')}\nNext: npm run news:start`)
  }else if(command==='doctor') {
    const env=await readEnv(credentials),docker=dockerReady()
    console.log(`${env.OPENAI_API_KEY?'OK':'MISSING'} / OpenAI API key\n${docker?'OK':'MISSING'} / Docker Desktop running\nOK / private credential file and generated infrastructure credentials`)
    if(docker)process.exitCode=await run(['exec','-T','desk','node','--import','tsx','server/doctor.ts',...(process.argv.includes('--account')?['--account']:[])])
    else{console.log('Install/open Docker Desktop, then npm run news:start. No paid model calls were made.');process.exitCode=1}
  }else if(command==='start') {
    if(!dockerReady())throw new Error('Docker Desktop is not installed or running. Open https://docs.docker.com/desktop/setup/install/mac-install/ then rerun npm run news:start.')
    const env=await readEnv(credentials)
    if(!env.OPENAI_API_KEY)console.log('OpenAI key is blank. The desk will open, but paid editorial runs remain unavailable.')
    process.exitCode=await run(['up','--build','--detach','--wait','--wait-timeout','180'])
    if(!process.exitCode)console.log('Open http://127.0.0.1:8080/admin\nYour desk key is in .local/news-access.txt.\nRun npm run news:doctor -- --account, then prepare your first edition from /admin → runs.')
  }else if(command==='stop')process.exitCode=await run(['stop'])
  else if(command==='production') {
    const env=await readEnv(credentials)
    if(!env.OPENAI_API_KEY || !/^[0-9a-f-]{36}$/i.test(env.NEWS_OWNER_ID||'') || !/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(env.NEWS_BACKEND_DOMAIN||'') || !env.NEWS_WEB_ORIGIN?.startsWith('https://') || !env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY)throw new Error('Production fields are incomplete. Read docs/news/START-HERE.md. Nothing deployed.')
    if(!dockerReady())throw new Error('Docker is not available on this host')
    process.exitCode=await run(['-f','compose.news.production.yaml','up','--build','--detach','--wait','--wait-timeout','180'])
  }
  else if(command==='logs')process.exitCode=await run(['logs','--tail','100','desk','executor'])
  else if(command==='verify')process.exitCode=await run(['exec','-T','desk','node','--import','tsx','server/doctor.ts','--paid-run'])
  else if(command==='backup') {
    await mkdir('.local/backups',{recursive:true,mode:0o700})
    const path=resolve(`.local/backups/news-${new Date().toISOString().replace(/[:.]/g,'-')}.sql`)
    const {open}=await import('node:fs/promises'),file=await open(path,'wx',0o600)
    const code=await new Promise((resolve,reject)=>{const child=spawn('docker',[...compose,'exec','-T','db','pg_dump','-U','news','--no-owner','news'],{stdio:['ignore',file.fd,'inherit']});child.on('error',reject);child.on('exit',code=>resolve(code))})
    await file.close();if(code!==0)throw new Error('Backup failed; do not use the incomplete file')
    console.log(`Private backup saved: ${path}`)
  }else throw new Error('Unknown setup command')
}catch(error){console.error(error.message);process.exitCode=1}
