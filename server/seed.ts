import { readFile } from 'node:fs/promises'
import { Settings, Source, type SourceConfig } from '../shared/news.js'
import type { Database } from './db.js'

export async function readSeedCharter(privatePath = 'docs/news/editor.md', publicPath = 'docs/news/editor.example.md') {
  try {
    return await readFile(privatePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return readFile(publicPath, 'utf8')
  }
}

export async function seed(db: Database) {
  const settings = Settings.parse({ charter: await readSeedCharter(), priorities: '', mainModel: 'gpt-6-astra', helperModel: 'gpt-5.6-luna', researchModel: 'gpt-5.6-terra', targetUsd: 6, softUsd: 8, hardUsd: 10, dailyStoryTarget: 8, wordsPerStory: 350 })
  await db.query("INSERT INTO news_private.settings(id,value) VALUES('editor',$1) ON CONFLICT DO NOTHING", [JSON.stringify(settings)])
  const registry: SourceConfig[] = JSON.parse(await readFile('docs/news/sources.json', 'utf8'))
  for (const input of registry) {
    const source = Source.parse(input)
    await db.query('INSERT INTO news_private.sources(id,config) VALUES($1,$2) ON CONFLICT DO NOTHING', [source.id, JSON.stringify(source)])
  }
}
