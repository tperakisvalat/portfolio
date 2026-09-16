import { readFile } from 'node:fs/promises'
import type { Database } from './db.js'
import { getSettings } from './store.js'
import { pricingSchema } from './editor.js'

export async function readiness(db:Database,checkModels=false) {
  const checks:{name:string;ok:boolean;detail:string;required:boolean}[]=[]
  const add=(name:string,ok:boolean,detail:string,required=true)=>checks.push({name,ok,detail,required})
  add('OpenAI key',!!process.env.OPENAI_API_KEY,process.env.OPENAI_API_KEY?'configured; value hidden':'Add OPENAI_API_KEY to .env.news.local')
  const settings=await getSettings(db)
  add('Database',true,'Schema is reachable; settings loaded')
  try {
    const pricing=pricingSchema.parse(JSON.parse(await readFile(process.env.NEWS_PRICING_FILE||'docs/news/pricing.example.json','utf8')))
    const fresh=Math.abs(Date.now()-new Date(pricing.checkedAt).getTime())<31*86400000
    add('Pricing',fresh&&[settings.value.mainModel,settings.value.helperModel,settings.value.researchModel,settings.value.reviewModel||settings.value.researchModel].every(m=>!!pricing.models[m]),`Verified ${pricing.checkedAt}; refresh with npm run news:prices`)
  }catch{add('Pricing',false,'Pricing file missing or invalid')}
  try {
    if(!process.env.NEWS_EXECUTOR_URL || !process.env.NEWS_EXECUTOR_TOKEN)throw new Error('not configured')
    const response=await fetch(`${process.env.NEWS_EXECUTOR_URL}/health`,{headers:{Authorization:`Bearer ${process.env.NEWS_EXECUTOR_TOKEN}`},signal:AbortSignal.timeout(3000)})
    add('Isolated executor',response.ok,response.ok?'reachable; real paid model run still required':'Executor rejected health check')
  }catch{add('Isolated executor',false,'Start the packaged stack with npm run news:start')}
  const [sources]=await db.query<any>("SELECT count(*)::int AS count FROM news_private.sources WHERE config->>'enabled'='true' AND config->>'adapter'='feed'")
  add('Source collection',sources.count>0,`${sources.count} enabled feeds; live search ${settings.value.searchEnabled?'on':'off'}`,!settings.value.searchEnabled)
  add('Schedule',settings.value.schedule.enabled,settings.value.schedule.enabled?`${settings.value.schedule.hour}:${String(settings.value.schedule.minute).padStart(2,'0')} ${settings.value.schedule.timezone}`:'Manual runs only; enable in editor settings when ready',false)
  add('Prediction markets',false,'Permission review required before connecting contracts; not required for news',false)
  if(checkModels&&process.env.OPENAI_API_KEY) {
    await Promise.all([...new Set([settings.value.mainModel,settings.value.helperModel,settings.value.researchModel,settings.value.reviewModel||settings.value.researchModel])].map(async model=>{
      try{const response=await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`,{headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},signal:AbortSignal.timeout(10000)});add(model,response.ok,response.ok?'Visible to this key. Generation/tool access is verified by the first real run.':`Account model check HTTP ${response.status}`)}catch{add(model,false,'Account check failed; no paid inference attempted')}
    }))
  }
  return {ready:checks.every(c=>!c.required||c.ok),checks,note:'Readiness checks are not a substitute for a successful end-to-end paid run and owner review.'}
}
