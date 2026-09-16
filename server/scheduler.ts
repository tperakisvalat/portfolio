import { randomUUID } from 'node:crypto'
import { Source, type EditorialSettings } from '../shared/news.js'
import type { Database } from './db.js'
import { getSettings, audit } from './store.js'
import { ingestSource } from './feeds.js'

export function dueEdition(schedule:EditorialSettings['schedule'],now=new Date()) {
  if(!schedule.enabled)return null
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:schedule.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now)
  const value=Object.fromEntries(parts.map(p=>[p.type,p.value]))
  if(Number(value.hour)*60+Number(value.minute)<schedule.hour*60+schedule.minute)return null
  return `${value.year}-${value.month}-${value.day}@${schedule.timezone}`
}
export async function queueScheduled(db:Database,now=new Date()) {
  const settings=await getSettings(db),key=dueEdition(settings.value.schedule,now)
  if(!key)return null
  return db.transaction(async tx=>{
    const [run]=await tx.query<any>("INSERT INTO news_private.runs(id,settings_version,settings_snapshot,status,schedule_key) VALUES($1,$2,$3,'queued',$4) ON CONFLICT(schedule_key) DO NOTHING RETURNING id",[randomUUID(),settings.version,JSON.stringify(settings.value),key])
    if(run)await audit(tx,'scheduler','run.create',run.id,null,{scheduleKey:key})
    return run || null
  })
}
export async function collectDue(db:Database,ingest=ingestSource,signal?:AbortSignal) {
  if(signal?.aborted)return []
  const rows=await db.query<any>(`SELECT config FROM news_private.sources WHERE config->>'enabled'='true' AND config->>'adapter'='feed'
    AND (last_checked_at IS NULL OR last_checked_at < now() - make_interval(mins => (config->>'cadenceMinutes')::int)) ORDER BY last_checked_at NULLS FIRST,id LIMIT 30`)
  const results=[]
  for(const row of rows){if(signal?.aborted)break;try{const config=Source.parse(row.config);results.push({id:config.id,...await ingest(db,config)})}catch(error){results.push({id:row.config.id,error:error instanceof Error?error.message:'Collection failed'})}}
  return results
}
