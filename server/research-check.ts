// Operator-only paid connector check. Run inside the desk container. It shares
// the real budget ledger, saves evidence, and never invokes the editor/publisher.
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { openDatabase } from './db.js'
import { getSettings, audit } from './store.js'
import { research } from './research.js'
import { pricingSchema } from './editor.js'

if(!process.env.OPENAI_API_KEY||!process.env.NEWS_PRICING_FILE)throw new Error('Desk provider configuration required')
const pricing=pricingSchema.parse(JSON.parse(await readFile(process.env.NEWS_PRICING_FILE,'utf8')))
const age=Date.now()-new Date(pricing.checkedAt).getTime()
if(age>31*86400000||age < -86400000)throw new Error('Refresh verified pricing before spending')
const db=await openDatabase()
let run:any
try {
  run=await db.transaction(async tx=>{
    await tx.query("SELECT id FROM news_private.settings WHERE id='editor' FOR UPDATE")
    if((await tx.query("SELECT id FROM news_private.runs WHERE status IN ('queued','running')")).length)throw new Error('An editorial run is active; do not interrupt or duplicate it')
    const settings=await getSettings(tx)
    const [row]=await tx.query<any>("INSERT INTO news_private.runs(id,settings_version,settings_snapshot,status,started_at) VALUES($1,$2,$3,'running',now()) RETURNING *",[randomUUID(),settings.version,JSON.stringify(settings.value)])
    await audit(tx,'local-operator','research.check',row.id,null,{purpose:'One paid research connector check; no edition or publication'})
    return row
  })
  console.log(`Research check / ${run.id}`)
  const result=await research(db,run,{query:'Find the most recent European Central Bank monetary policy decision published on or before 8 September 2026. Verify the decision date and deposit facility rate from the original ECB press release. Explain briefly how the announced decision changes or maintains the policy stance.',domains:['ecb.europa.eu']},pricing.models,AbortSignal.timeout(360000))
  console.log(JSON.stringify({result:'PASS',researchId:result.researchId,sources:result.sources.map(s=>({url:s.url,title:s.title,passages:s.passages.length}))}))
  await db.query("UPDATE news_private.runs SET status='cancelled',finished_at=now(),error='Research-only check passed; no edition requested' WHERE id=$1",[run.id])
}catch(error) {
  const message=error instanceof Error?error.message:'Research check failed'
  if(run)await db.query("UPDATE news_private.runs SET status='failed',finished_at=now(),error=$2 WHERE id=$1",[run.id,message.slice(0,600)])
  console.error(message);process.exitCode=1
}finally{await db.close()}
