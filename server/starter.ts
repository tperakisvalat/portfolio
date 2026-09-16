import { readFile } from 'node:fs/promises'
import { Source } from '../shared/news.js'
import type { Database } from './db.js'
import { audit } from './store.js'

export async function activateStarterSources(db:Database) {
  const pack=JSON.parse(await readFile('docs/news/starter-sources.json','utf8'))
  return db.transaction(async tx=>{
    // One-time adoption only. An owner disabling/editing a source is never overridden.
    await tx.query("SELECT id FROM news_private.settings WHERE id='editor' FOR UPDATE")
    if((await tx.query("SELECT id FROM news_private.audit WHERE action='starter.install' LIMIT 1")).length)return {installed:false}
    for(const input of pack.sources) {
      const [existing]=await tx.query<any>('SELECT * FROM news_private.sources WHERE id=$1',[input.id])
      if(existing && existing.version!==1)continue
      const source=Source.parse({...existing?.config,...input})
      await tx.query('INSERT INTO news_private.sources(id,config) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET config=excluded.config,version=news_private.sources.version+1',[source.id,JSON.stringify(source)])
    }
    await audit(tx,'setup','starter.install','launch-v1',null,{count:pack.sources.length})
    return {installed:true,count:pack.sources.length}
  })
}
