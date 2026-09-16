import type { Database } from './db.js'

export async function runMetrics(db:Database,runId:string) {
  const rows=await db.query<any>(`SELECT u.model,u.state,u.reserved_usd,u.actual_usd,m.after_value AS context
    FROM news_private.usage u LEFT JOIN LATERAL (
      SELECT after_value FROM news_private.audit WHERE action='usage.context' AND entity_id=u.id::text
      ORDER BY created_at DESC,id DESC LIMIT 1
    ) m ON true WHERE u.run_id=$1`,[runId])
  const stages:Record<string,{phase:string;model:string;calls:number;committedUsd:number;settledUsd:number;unknownCalls:number;inputTokens:number;cachedInputTokens:number;outputTokens:number;searchActions:number}>={}
  for(const row of rows) {
    const phase=row.context?.phase||'unclassified',key=`${phase}:${row.model}`
    const stage=stages[key]??={phase,model:row.model,calls:0,committedUsd:0,settledUsd:0,unknownCalls:0,inputTokens:0,cachedInputTokens:0,outputTokens:0,searchActions:0}
    stage.calls++;stage.committedUsd+=Number(row.actual_usd??row.reserved_usd)
    if(row.state==='settled')stage.settledUsd+=Number(row.actual_usd)
    if(row.state==='unknown')stage.unknownCalls++
    stage.inputTokens+=Number(row.context?.usage?.input_tokens||0)
    stage.cachedInputTokens+=Number(row.context?.usage?.input_tokens_details?.cached_tokens||0)
    stage.outputTokens+=Number(row.context?.usage?.output_tokens||0)
    stage.searchActions+=Number(row.context?.calls||0)
  }
  return {stages:Object.values(stages),committedUsd:Object.values(stages).reduce((n,s)=>n+s.committedUsd,0),note:'Metered estimates, including retained reservations. Unclassified historical calls predate phase instrumentation. Quality is assessed separately; tokens and story count are not quality scores.'}
}
