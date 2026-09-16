import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { createHash, randomUUID } from 'node:crypto'
import { safeFetch } from './fetch.js'
import type { Database } from './db.js'
import type { SourceConfig } from '../shared/news.js'

const array = (value: any): any[] => value == null ? [] : Array.isArray(value) ? value : [value]
const string = (value: any): string => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : value?.['#text'] || ''
export function decodeEntities(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (raw, name: string) => {
    if (name.startsWith('#')) { const n=parseInt(name.slice(name[1]?.toLowerCase()==='x'?2:1),name[1]?.toLowerCase()==='x'?16:10);return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):raw }
    return ({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '} as Record<string,string>)[name.toLowerCase()] || raw
  })
}
export const plain = (value: any) => decodeEntities(string(value).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
export function canonicalUrl(input: string) {
  const url = new URL(decodeEntities(input))
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid article URL')
  url.hash = ''
  for (const name of [...url.searchParams.keys()]) if (/^(?:amp;)*(?:utm_|fbclid$|gclid$|traffic_source$)/i.test(name)) url.searchParams.delete(name)
  return url.href
}
export function parseFeed(xml: string, source: SourceConfig) {
  const markup=xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
  if (/<!DOCTYPE|<!ENTITY/i.test(markup) || XMLValidator.validate(xml) !== true) throw new Error('Invalid or unsafe feed XML')
  const data = new XMLParser({ ignoreAttributes: false, processEntities: false, parseTagValue: false }).parse(xml)
  const entries = data.rss?.channel?.item || data.feed?.entry || data['rdf:RDF']?.item
  if (!entries) throw new Error('No recognized RSS, Atom or RDF entries')
  return array(entries).slice(0, 100).flatMap(item => {
    const title = plain(item.title).slice(0, 500)
    const link = array(item.link).find(v => typeof v === 'string' || !v['@_rel'] || v['@_rel'] === 'alternate')
    let url: string
    try { url = canonicalUrl(typeof link === 'object' ? link['@_href'] : string(link)) } catch { return [] }
    if (!title) return []
    const original = string(item.pubDate || item.published || item['dc:date'])
    const date = original ? new Date(original) : null
    // Atom updated is NOT a substitute for the original publication date.
    const publishedAt = date && Number.isFinite(date.getTime()) && date.getTime() <= Date.now() + 86400000 ? date.toISOString() : null
    const evidence = source.processing === 'feed-text' ? plain(item.content || item['content:encoded'] || item.summary || item.description).slice(0, 20000) || null : null
    return [{ id: randomUUID(), url, title, publishedAt, author: plain(item.author?.name || item.author || item['dc:creator']).slice(0,300) || null, evidence, evidenceLevel: evidence ? 'feed-text' : 'metadata', hash: createHash('sha256').update(`${title}\n${evidence || ''}`).digest('hex') }]
  })
}
export async function ingestSource(db: Database, source: SourceConfig, fetcher = safeFetch) {
  if (!source.enabled || source.adapter !== 'feed' || !source.endpoint) throw new Error('Source is not enabled with a supported connector')
  const lease = await db.query('UPDATE news_private.sources SET lease_until=now()+interval \'90 seconds\' WHERE id=$1 AND (lease_until IS NULL OR lease_until<now()) RETURNING id', [source.id])
  if (!lease.length) return { skipped: true, count: 0 }
  try {
    const xml = await fetcher(source.endpoint, [new URL(source.endpoint).hostname])
    const entries = parseFeed(xml, source)
    let count = 0
    for (const item of entries) {
      const inserted = await db.query(`INSERT INTO news_private.items(id,source_id,canonical_url,title,author,published_at,evidence,evidence_level,content_hash,kind)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(canonical_url) DO NOTHING RETURNING id`, [item.id,source.id,item.url,item.title,item.author,item.publishedAt,item.evidence,item.evidenceLevel,item.hash,source.family])
      count += inserted.length
      if (!inserted.length) {
        // A later owner-approved processing change must backfill existing feed
        // evidence. Preserve original date and source identity; never re-age it.
        await db.query(`UPDATE news_private.items SET title=$3,author=coalesce(author,$4),
          published_at=coalesce(published_at,$5::timestamptz),evidence=$6,evidence_level=$7,
          content_hash=$8,retrieved_at=now() WHERE canonical_url=$1 AND source_id=$2`,
          [item.url,source.id,item.title,item.author,item.publishedAt,item.evidence,item.evidenceLevel,item.hash])
      }
    }
    await db.query('UPDATE news_private.sources SET last_checked_at=now(),last_success_at=now(),last_error=NULL,lease_until=NULL WHERE id=$1', [source.id])
    return { skipped: false, count }
  } catch (error) {
    await db.query('UPDATE news_private.sources SET last_checked_at=now(),last_error=$2,lease_until=NULL WHERE id=$1', [source.id, error instanceof Error ? error.message : 'Ingestion failed'])
    throw error
  }
}
