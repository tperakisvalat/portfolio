import { createHash, randomUUID } from 'node:crypto'
import { Draft, Settings, Source, readStoredSettings, editorialClaims, type DraftContent } from '../shared/news.js'
import { figureText } from '../shared/news-visuals.js'
import type { Database } from './db.js'

export class HttpError extends Error { constructor(public statusCode: number, message: string) { super(message) } }
export const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export async function audit(db: Database, actor: string, action: string, id: string, before: unknown, after: unknown) {
  await db.query('INSERT INTO news_private.audit(id,actor,action,entity_id,before_value,after_value) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(),actor,action,id,JSON.stringify(before),JSON.stringify(after)])
}
export async function getSettings(db: Database) {
  const [row] = await db.query<any>("SELECT * FROM news_private.settings WHERE id='editor'")
  if (!row) throw new HttpError(503, 'Database not initialized')
  return { ...row, value: readStoredSettings(row.value) }
}
export async function updateVersioned(db: Database, actor: string, kind: 'sources'|'settings', id: string, expected: number, input: unknown) {
  const value = kind === 'sources' ? Source.parse(input) : Settings.parse(input)
  if (kind === 'sources' && (value as any).id !== id) throw new HttpError(400,'Source ID cannot change')
  return db.transaction(async tx => {
    const [before] = await tx.query<any>(`SELECT * FROM news_private.${kind} WHERE id=$1 FOR UPDATE`,[id])
    if (!before) throw new HttpError(404,'Not found')
    if (before.version !== expected) throw new HttpError(409,'Changed since you opened it. Reload before editing.')
    const field = kind === 'sources' ? 'config' : 'value'
    const [after] = await tx.query<any>(`UPDATE news_private.${kind} SET ${field}=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *`,[id,JSON.stringify(value)])
    await audit(tx,actor,`${kind}.update`,id,before,after)
    return after
  })
}
export async function validateEvidence(db: Database, content: DraftContent) {
  for(const placement of content.marketPlacements) {
    const [market]=await db.query('SELECT id FROM news_private.market_links WHERE id=$1 AND enabled=true',[placement.marketId])
    if(!market)throw new HttpError(422,'Market placements require exact owner-approved contracts')
  }
  const claims = editorialClaims(content)
  const ids = [...new Set([...claims.flatMap(s=>s.citations.map(c=>c.itemId)),...content.library.map(e=>e.itemId)])]
  if (!ids.length) throw new HttpError(422,'Draft has no content')
  const rows = await db.query<any>('SELECT i.*,s.config FROM news_private.items i JOIN news_private.sources s ON s.id=i.source_id WHERE i.id=ANY($1::uuid[])',[ids])
  const byId = new Map(rows.map(row=>[row.id,row]))
  if (rows.length !== ids.length) throw new HttpError(422,'Unknown source item ID')
  for (const story of claims) {
    for (const citation of story.citations) {
      const item = byId.get(citation.itemId)
      if(citation.researchId) {
        const [note]=await db.query<any>('SELECT report,sources FROM news_private.research WHERE id=$1',[citation.researchId])
        const source=note?.sources.find((s:any)=>s.itemId===citation.itemId)
        if(source?.evidenceUse==='discovery-only')throw new HttpError(422,'Discovery scans are leads, not story evidence. Investigate or read the original first.')
        if(!source || !source.passages?.some((p:string)=>p.toLowerCase().includes(citation.locator.toLowerCase())))throw new HttpError(422,'Research citation must match the saved passage attributed to that source')
        continue
      }
      if (!item.evidence || item.evidence_level === 'metadata' || item.config.processing !== 'feed-text') throw new HttpError(422,'Stories require permitted text evidence, not just a headline')
      // Locator must identify an actual passage, not the model asserting "verified".
      if (!item.evidence.toLowerCase().includes(citation.locator.toLowerCase())) throw new HttpError(422,'Citation passage does not occur in the stored evidence')
    }
  }
  return byId
}
export async function saveDraft(db: Database, actor: string, input: unknown, id?: string, expected?: number, settingsVersion?: number) {
  const content = Draft.parse(input)
  const settings = await getSettings(db)
  return db.transaction(async tx => {
    await validateEvidence(tx,content)
    const [before] = id ? await tx.query<any>('SELECT * FROM news_private.drafts WHERE id=$1 FOR UPDATE',[id]) : []
    if (id && !before) throw new HttpError(404,'Draft not found')
    if (before && (before.version !== expected || before.status !== 'draft')) throw new HttpError(409,'Draft version changed or already published')
    const [after] = before
      ? await tx.query<any>('UPDATE news_private.drafts SET content=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *',[id,JSON.stringify(content)])
      : await tx.query<any>('INSERT INTO news_private.drafts(id,content,settings_version) VALUES($1,$2,$3) RETURNING *',[randomUUID(),JSON.stringify(content),settingsVersion ?? settings.version])
    await audit(tx,actor,'draft.save',after.id,before || null,after)
    return after
  })
}
export async function publish(db: Database, actor: string, id: string, expected: number, key: string) {
  return db.transaction(async tx => {
    // Lock the draft first: concurrent retries serialize before idempotency lookup.
    const [draft] = await tx.query<any>('SELECT * FROM news_private.drafts WHERE id=$1 FOR UPDATE',[id])
    if (!draft) throw new HttpError(404,'Draft not found')
    const requestHash = hash(JSON.stringify({id,expected}))
    const [retry] = await tx.query<any>('SELECT * FROM news_private.idempotency WHERE actor=$1 AND key=$2',[actor,key])
    if (retry) { if (retry.request_hash !== requestHash) throw new HttpError(409,'Idempotency key reused for a different request'); return retry.result }
    if (draft.version !== expected || draft.status !== 'draft') throw new HttpError(409,'Approve the current unpublished version')
    const content = Draft.parse(draft.content)
    const items = await validateEvidence(tx,content)
    // Freeze cited title/URL/source with the approved edition; no private review fields leak.
    const projection = publicProjection(content, items)
    const [edition] = await tx.query<any>('INSERT INTO news_private.editions(id,draft_id,draft_version,content) VALUES($1,$2,$3,$4) RETURNING id,published_at,content',[randomUUID(),id,expected,JSON.stringify(projection)])
    for (const entry of content.library) {
      await tx.query('INSERT INTO news_private.library(item_id,annotation,edition_id) VALUES($1,$2,$3) ON CONFLICT(item_id) DO UPDATE SET annotation=excluded.annotation,edition_id=excluded.edition_id,approved_at=now()',[entry.itemId,entry.annotation,edition.id])
      await tx.query('DELETE FROM news_private.library_topics WHERE item_id=$1',[entry.itemId])
      for (const topic of new Set(entry.topics)) await tx.query('INSERT INTO news_private.library_topics(item_id,topic) VALUES($1,$2)',[entry.itemId,topic])
    }
    await tx.query("UPDATE news_private.drafts SET status='published',updated_at=now() WHERE id=$1",[id])
    await tx.query('UPDATE news_private.market_links SET selected=false WHERE enabled=true')
    for(const placement of content.marketPlacements)await tx.query('UPDATE news_private.market_links SET selected=true,topic=$2,version=version+1 WHERE id=$1',[placement.marketId,placement.topic])
    await audit(tx,actor,'edition.publish',edition.id,{draftId:id,version:expected},{editionId:edition.id})
    await tx.query('INSERT INTO news_private.idempotency(actor,key,request_hash,result) VALUES($1,$2,$3,$4)',[actor,key,requestHash,JSON.stringify(edition)])
    return edition
  })
}
// Explicit allowlist used for publishing and reader-facing previews. Neither
// citations' private locators nor research IDs may enter the public payload.
export function publicProjection(content: DraftContent, items: Map<string, any>) {
  const sources = (citations: DraftContent['stories'][number]['citations']) => citations
    .filter((c,index,all) => all.findIndex(other => other.itemId===c.itemId)===index)
    .map(c => { const i=items.get(c.itemId); return {itemId:i.id,title:i.title,url:i.canonical_url,publisher:i.source_id==='web-research'?new URL(i.canonical_url).hostname:i.config.name,evidenceType:c.researchId?'web-research':'feed-text'} })
  return { date:content.date, cutoff:content.cutoff,
    stories:content.stories.map(s => ({ id:s.id,pillar:s.pillar,title:s.title,body:s.body,sources:sources(s.citations),
      ...(s.visuals ? {visuals:s.visuals.map(({citations,...figure}) => ({...figure,sources:sources(citations)}))} : {}) })),
    ...(content.headlines ? {headlines:content.headlines.map(({citations,...headline}) => ({...headline,sources:sources(citations)}))} : {}),
  }
}
export async function latestEdition(db: Database) {
  return (await db.query<any>('SELECT id,published_at,content FROM news_private.editions ORDER BY published_at DESC,id DESC LIMIT 1'))[0] || null
}
export function briefText(edition: any) {
  if (!edition) return 'tpv.world / no published edition yet\n'
  const d=edition.content
  const sourceLines = (sources:any[]) => sources.map((r:any)=>`${r.publisher} / ${r.title}\n${r.url}`)
  return [`tpv.world / ${d.date}`,`edition: ${edition.id}`,`published: ${new Date(edition.published_at).toISOString()}`,`cutoff: ${d.cutoff}`,'',
    ...(d.headlines?.length ? ['elsewhere',...d.headlines.flatMap((h:any)=>['',`${h.eventDate} / ${h.pillar}`,h.title,h.body,...sourceLines(h.sources)]),''] : []),
    ...['macro','politics','business','tech'].filter(p=>d.stories.some((s:any)=>s.pillar===p)).flatMap(p=>[p,...d.stories.filter((s:any)=>s.pillar===p).flatMap((s:any)=>['',s.title,s.body,...(s.visuals||[]).flatMap((v:any)=>['',figureText(v),...sourceLines(v.sources)]),...sourceLines(s.sources)]),''])].join('\n')
}
