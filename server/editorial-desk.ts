import { Pillar } from '../shared/news.js'
import type { Database } from './db.js'

export async function deskSnapshot(db: Database, cutoff: string) {
  // Cap each publisher BEFORE capping each pillar. One wire's rapid news cycle
  // must not hide a weekly research publication. Dates are publication dates.
  const candidates = await db.query<any>(`WITH per_source AS (
    SELECT i.id,i.source_id,i.title,i.author,i.canonical_url AS url,i.published_at,i.evidence_level,
      s.config->>'name' AS publisher,s.config->>'family' AS family,s.config->'pillars' AS pillars,
      row_number() OVER (PARTITION BY i.source_id ORDER BY i.published_at DESC NULLS LAST,i.id) AS rank
    FROM news_private.items i JOIN news_private.sources s ON s.id=i.source_id
    WHERE s.config->>'enabled'='true' AND i.published_at <= $1::timestamptz
      AND i.published_at >= $1::timestamptz - interval '14 days'
  ) SELECT id,source_id,title,author,url,published_at,evidence_level,publisher,family,pillars
    FROM per_source WHERE rank<=5 ORDER BY rank,published_at DESC,id LIMIT 160`, [cutoff])
  const sources = await db.query<any>("SELECT id,config->>'name' AS name,config->>'family' AS family,config->'pillars' AS pillars,last_success_at,last_error FROM news_private.sources WHERE config->>'enabled'='true' ORDER BY id")
  const [prior, feedback, notes] = await Promise.all([
    db.query<any>('SELECT id,content FROM news_private.editions ORDER BY published_at DESC LIMIT 2'),
    db.query<any>('SELECT text,created_at FROM news_private.feedback ORDER BY created_at DESC LIMIT 8'),
    db.query<any>('SELECT id AS research_id,left(query,350) AS query,created_at AS checked_at FROM news_private.research ORDER BY created_at DESC LIMIT 16'),
  ])
  return {
    cutoff,
    pillars: Object.fromEntries(Pillar.options.map(p => [p, candidates.filter(c => c.pillars.includes(p)).slice(0, 16).map(({id,title,url,publisher,published_at,evidence_level,source_id,family})=>({id,title,url,publisher,published_at,evidence_level,source_id,family}))])),
    sources, previousEditions: prior.map(v=>({id:v.id,date:v.content.date,stories:v.content.stories.map((s:any)=>({id:s.id,pillar:s.pillar,title:s.title,summary:s.body.slice(0,400)}))})), feedback, savedResearch: notes,
    note: 'Balanced discovery metadata, NOT story evidence or a complete news agenda. Scan missing important developments on the web. A new headline or a familiar author is not an editorial selection. Recent previous editions are context, not a ban on substantially improving a same-day edition.',
  }
}
