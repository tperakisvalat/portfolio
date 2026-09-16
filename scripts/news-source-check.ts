import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { Source } from '../shared/news.js'
import { safeFetch } from '../server/fetch.js'
import { parseFeed } from '../server/feeds.js'
const registry=JSON.parse(await readFile('docs/news/sources.json','utf8'))
const starter=JSON.parse(await readFile('docs/news/starter-sources.json','utf8'))
const results=[]
for(const override of starter.sources) {
  const source=Source.parse({...registry.find((s:any)=>s.id===override.id),...override})
  try{const items=parseFeed(await safeFetch(source.endpoint!,[new URL(source.endpoint!).hostname]),{...source,processing:'metadata'});results.push({id:source.id,endpoint:source.endpoint,ok:true,count:items.length,dated:items.filter(i=>i.publishedAt).length});console.log(`OK / ${source.name} / ${items.length} entries`)}
  catch(error){results.push({id:source.id,endpoint:source.endpoint,ok:false,error:error instanceof Error?error.message:'Failed'});console.log(`CHECK / ${source.name} / ${results.at(-1)!.error}`)}
}
await mkdir('.local',{recursive:true})
await writeFile('.local/news-source-check.json',JSON.stringify({checkedAt:new Date().toISOString(),note:'Technical metadata access only. Not a blanket license to process or republish publisher full text.',results},null,2)+'\n',{mode:0o600})
