import { z } from 'zod'
import { Topic, SafeUrl } from '../shared/news.js'
import { safeFetch } from './fetch.js'
import type { Database } from './db.js'

export const MarketLink=z.object({provider:z.enum(['kalshi','polymarket']),externalId:z.string().regex(/^[a-zA-Z0-9_-]{1,180}$/),url:SafeUrl,topic:Topic,enabled:z.boolean(),permissionReference:z.string().min(30).max(3000)}).strict().refine(v=>[`${v.provider}.com`,`www.${v.provider}.com`].includes(new URL(v.url).hostname),'Use the original provider contract page')
const probability=(value:unknown)=>{if(value==null||value==='')return null;const n=Number(value);return Number.isFinite(n)&&n>=0&&n<=1?n:null}
const list=(value:any)=>Array.isArray(value)?value:typeof value==='string'?JSON.parse(value):[]
export function normalizeMarket(provider:'kalshi'|'polymarket',input:any,expectedId:string) {
  if(provider==='polymarket') {
    if(String(input.id)!==expectedId)throw new Error('Provider returned a different contract')
    const outcomes=list(input.outcomes),prices=list(input.outcomePrices)
    if(!outcomes.length || outcomes.length!==prices.length)throw new Error('Market outcomes are incomplete')
    return {title:String(input.question||expectedId),url:`https://polymarket.com/event/${encodeURIComponent(input.slug||expectedId)}`,status:input.closed?'closed':input.active&&input.acceptingOrders?'active':'inactive',
      outcomes:outcomes.map((label:any,i:number)=>({label:String(label),probability:probability(prices[i])})),priceType:'provider outcome price',rules:String(input.description||''),closeTime:input.endDate||null,providerUpdatedAt:input.updatedAt||null}
  }
  const m=input.market
  if(m?.ticker!==expectedId || m.market_type!=='binary')throw new Error('Only exact binary Kalshi contracts are supported')
  return {title:String(m.title||m.yes_sub_title||expectedId),url:`https://kalshi.com/markets/${encodeURIComponent(m.event_ticker||expectedId).toLowerCase()}`,status:m.status==='active'?'active':m.status||'unknown',
    outcomes:[{label:'Yes',probability:probability(m.last_price_dollars)}],priceType:'last trade; not an executable quote',rules:String(m.rules_primary||''),closeTime:m.close_time||null,providerUpdatedAt:m.updated_time||null}
}
export async function refreshMarkets(db:Database,fetcher=safeFetch,signal?:AbortSignal) {
  if(signal?.aborted)return
  const links=await db.query<any>("SELECT * FROM news_private.market_links WHERE enabled=true AND (checked_at IS NULL OR checked_at<now()-interval '5 minutes') LIMIT 30")
  for(const link of links) {
    if(signal?.aborted)break
    // Owner-approved display/use basis is required before any provider data is fetched.
    if(link.permission_reference.length<30 || !link.public_url)continue
    try {
      const url=link.provider==='polymarket'?`https://gamma-api.polymarket.com/markets/${encodeURIComponent(link.external_id)}`:`https://api.elections.kalshi.com/trade-api/v2/markets/${encodeURIComponent(link.external_id)}`
      const quote=normalizeMarket(link.provider,JSON.parse(await fetcher(url,[new URL(url).hostname])),link.external_id)
      quote.url=link.public_url
      await db.query('UPDATE news_private.market_links SET quote=$2,checked_at=now(),error=NULL WHERE id=$1 AND version=$3',[link.id,JSON.stringify(quote),link.version])
    }catch(error){await db.query('UPDATE news_private.market_links SET checked_at=now(),error=$2 WHERE id=$1 AND version=$3',[link.id,error instanceof Error?error.message:'Market unavailable',link.version])}
  }
}
export async function publicMarkets(db:Database,topic?:string) {
  const rows=await db.query<any>('SELECT id,provider,topic,quote,checked_at,error FROM news_private.market_links WHERE enabled=true AND selected=true AND ($1::text IS NULL OR topic=$1)',[topic||null])
  return {items:rows.map(row=>{const stale=!!row.error||!row.checked_at||Date.now()-new Date(row.checked_at).getTime()>15*60*1000;return {id:row.id,provider:row.provider,topic:row.topic,checkedAt:row.checked_at,stale,quote:stale?null:row.quote}}),status:rows.length?'connected':'access-review'}
}
