import { useEffect, useRef, useState } from 'react'

export function NewsReadiness({ api }) {
  const [result,setResult]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const check=async(account=false)=>{setBusy(true);setError('');try{setResult(await api(`/readiness${account?'?account=true':''}`))}catch(e){setError(e.message)}finally{setBusy(false)}}
  useEffect(()=>{let active=true;api('/readiness').then(r=>{if(active)setResult(r)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[api])
  return <div><h3>connections</h3><p role="status">{error}</p>{result?.checks.map(c=><p key={c.name}>{c.ok?'✓':c.required?'—':'·'} {c.name}<br/><small>{c.detail}</small></p>)}<button disabled={busy} onClick={()=>check(true)}>{busy?'checking…':'check account + connections'}</button><p className="na-note">Account checks do not call a model. Prepare one edition under runs to test the complete paid workflow. It stays private until you approve it.</p></div>
}
export function NewsFeedback({ api }) {
  const [items,setItems]=useState([]),[text,setText]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
  useEffect(()=>{let active=true;api('/feedback').then(rows=>{if(active)setItems(rows)}).catch(e=>{if(active)setMessage(e.message)});return()=>{active=false}},[api])
  const save=async()=>{setBusy(true);try{const row=await api('/feedback',{method:'POST',body:{text}});setItems(previous=>[row,...previous]);setText('');setMessage('saved for the next edition')}catch(e){setMessage(e.message)}finally{setBusy(false)}}
  return <div><h3>notes to the editor</h3><label>What worked? What missed? What should it investigate next?<textarea rows="6" value={text} onChange={e=>setText(e.target.value)}/></label><button disabled={busy||text.trim().length<5} onClick={save}>save note</button><p role="status">{message}</p><p className="na-note">Notes inform the next run. They don’t silently rewrite the charter.</p>{items.map(item=><article className="na-story" key={item.id}><small>{new Date(item.created_at).toLocaleString()}</small><p>{item.text}</p></article>)}</div>
}
export function NewsRunDetails({ api, runId }) {
  const [records,setRecords]=useState(null),[metrics,setMetrics]=useState(null),[commission,setCommission]=useState(null),[error,setError]=useState('')
  const load=async event=>{
    if(!event.currentTarget.open||records)return
    try { const run=await api(`/runs/${runId}`);setRecords(run.editorial||[]);setMetrics(run.metrics||null);setCommission(run.commission||null) } catch(e) { setError(e.message) }
  }
  return <details onToggle={load}><summary>commissioning + review</summary><p role="status">{error}</p>{commission&&<div><p>{commission.kind}{commission.variant?` / ${commission.variant}`:''}</p>{commission.draftId&&<a href={`/admin?draft=${encodeURIComponent(commission.draftId)}`}>source draft / v{commission.version}</a>}{commission.note&&<p style={{whiteSpace:'pre-wrap'}}>{commission.note}</p>}{commission.limitations&&<p className="na-note">{commission.limitations}</p>}</div>}{metrics&&<div><p>run / ${metrics.committedUsd.toFixed(2)}</p>{metrics.stages.map(s=><p key={`${s.phase}:${s.model}`}><small>{s.phase} / {s.model} / {s.calls} calls / ${s.committedUsd.toFixed(2)}{s.searchActions?` / ${s.searchActions} search actions`:''}{s.unknownCalls?` / ${s.unknownCalls} uncertain costs retained`:''}</small></p>)}<p className="na-note">{metrics.note}</p></div>}{records?.length===0&&<p>No editorial record saved.</p>}{records?.map((entry,index)=><section key={index} className="na-story"><small>{new Date(entry.created_at).toLocaleString()} / {entry.action.replace('editor.','')}</small>
    {entry.action==='editor.review'&&<><p>{entry.record.status?.replaceAll('_',' ')}</p><p>{entry.record.review?.assessment}</p>{[...(entry.record.checks?.problems||[]),...(entry.record.review?.editionProblems||[])].map((problem,i)=><p key={i}>{problem}</p>)}{entry.record.review?.stories?.map(story=><details key={story.storyId}><summary>{story.storyId} / {story.decision}</summary><p>{story.learned}</p>{story.problems.map((problem,i)=><p key={i}>{problem}</p>)}<p>{story.revision}</p></details>)}</>}
    {entry.action==='editor.plan'&&entry.record.pillars?.map(p=><details key={p.pillar}><summary>{p.pillar} / {p.candidates.length} candidates</summary>{p.candidates.map((candidate,i)=><article key={i}><h4>{candidate.question}</h4><p>{candidate.whyNow}</p><p>To establish: {candidate.reportingNeeded}</p></article>)}</details>)}
    {entry.action==='editor.plan'&&!!entry.record.agenda?.length&&<details><summary>wider news / selection and omissions</summary>{entry.record.agenda.map((item,i)=><article key={i}><h4>{item.event} / {item.destination}</h4><p>{item.whyImportant}</p><p>{item.reason}</p>{item.sources.map((s,n)=><p key={n}>{s}</p>)}</article>)}</details>}
    {entry.action==='editor.research_rejected'&&<><p>{entry.record.reason}</p><p>{entry.record.query}</p><details><summary>unverified report / not evidence</summary><p style={{whiteSpace:'pre-wrap'}}>{entry.record.report}</p></details></>}
  </section>)}</details>
}
const freshMarket={provider:'polymarket',externalId:'',url:'',topic:'macro:rates',enabled:false,permissionReference:''}
export function NewsAccess({ api }) {
  const [rows,setRows]=useState([]),[name,setName]=useState('personal assistant'),[token,setToken]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
  useEffect(()=>{let active=true;api('/tokens').then(data=>{if(active)setRows(data)}).catch(e=>{if(active)setMessage(e.message)});return()=>{active=false}},[api])
  const action=async fn=>{setBusy(true);try{await fn();setRows(await api('/tokens'))}catch(e){setMessage(e.message)}finally{setBusy(false)}}
  return <div><h3>assistant access</h3><p className="na-note">Can read, edit the charter, leave feedback, edit drafts and update source metadata. Cannot publish, spend, enable sources, grant market rights, or change models and budgets. Expires after 90 days.</p><label>Name<input value={name} onChange={e=>setName(e.target.value)}/></label><button disabled={busy||name.length<2} onClick={()=>action(async()=>{const result=await api('/tokens',{method:'POST',body:{name}});setToken(result.token);setMessage('Copy this key now. It will not be shown again.')})}>create scoped key</button><p role="status">{message}</p>{token&&<label>New key / private<input readOnly value={token} onFocus={e=>e.target.select()}/><button onClick={()=>setToken('')}>hide</button></label>}{rows.map(row=><div className="na-story" key={row.id}>{row.name} / {row.revoked_at?'revoked':`expires ${new Date(row.expires_at).toLocaleDateString()}`}<button disabled={busy||!!row.revoked_at} onClick={()=>action(()=>api(`/tokens/${row.id}/revoke`,{method:'POST'}))}>revoke</button></div>)}</div>
}
export function ResearchEvidence({ api, citation }) {
  const [report,setReport]=useState(null),[error,setError]=useState('')
  const pending=useRef(false)
  const load=async event=>{
    if(!event.currentTarget.open||report||pending.current)return
    pending.current=true;setError('')
    try{setReport(await api(`/research/${citation.researchId}`))}catch(e){setError(e.message)}finally{pending.current=false}
  }
  const source=report?.sources.find(s=>s.itemId===citation.itemId)
  return <details onToggle={load}><summary>web research / derived evidence</summary><p>{citation.locator}</p><p className="na-note">This passage is from the researcher’s cited report, not a quotation from the article. Review the original before approving.</p>{source&&<a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a>}{report&&<details><summary>full research note</summary><p style={{whiteSpace:'pre-wrap'}}>{report.report}</p></details>}<p>{error}</p></details>
}
export function NewsMarketAdmin({ api }) {
  const [rows,setRows]=useState([]),[value,setValue]=useState(freshMarket),[selected,setSelected]=useState(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
  const reload=()=>api('/markets').then(setRows)
  useEffect(()=>{let active=true;api('/markets').then(data=>{if(active)setRows(data)}).catch(e=>{if(active)setMessage(e.message)});return()=>{active=false}},[api])
  const action=async fn=>{setBusy(true);setMessage('');try{await fn();await reload()}catch(e){setMessage(e.message)}finally{setBusy(false)}}
  const choose=row=>{setSelected(row);setValue({provider:row.provider,externalId:row.external_id,url:row.public_url||'',topic:row.topic,enabled:row.enabled,permissionReference:row.permission_reference})}
  return <div><h3>contracts</h3><p className="na-note">No trading keys needed. Before enabling, document permission for this use and public display. Kalshi requires particular care; public API access alone is not a reuse license.</p><div className="na-columns"><aside><button onClick={()=>{setSelected(null);setValue(freshMarket)}}>+ contract</button>{rows.map(row=><button key={row.id} onClick={()=>choose(row)}>{row.provider} / {row.external_id}<small>{row.enabled?'on':'off'} / {row.topic}</small></button>)}</aside><div><label>Provider<select value={value.provider} onChange={e=>setValue({...value,provider:e.target.value})}><option>polymarket</option><option>kalshi</option></select></label><label>Exact market ID / Kalshi ticker<input value={value.externalId} onChange={e=>setValue({...value,externalId:e.target.value})}/></label><label>Original contract link<input value={value.url} onChange={e=>setValue({...value,url:e.target.value})}/></label><label>Topic / e.g. tech:infrastructure<input value={value.topic} onChange={e=>setValue({...value,topic:e.target.value})}/></label><label>Use / display permission reference<textarea rows="5" value={value.permissionReference} onChange={e=>setValue({...value,permissionReference:e.target.value})}/></label><label className="na-check"><input type="checkbox" checked={value.enabled} onChange={e=>setValue({...value,enabled:e.target.checked})}/>permission reviewed / enable</label><button disabled={busy} onClick={()=>action(async()=>{const saved=await api(selected?`/markets/${selected.id}`:'/markets',{method:selected?'PUT':'POST',body:selected?{expectedVersion:selected.version,value}:value});choose(saved);setMessage('saved')})}>save contract</button><button disabled={busy} onClick={()=>action(async()=>{await api('/markets/refresh',{method:'POST'});setMessage('quotes refreshed')})}>refresh approved contracts</button><p role="status">{message}</p>{selected?.error&&<p>{selected.error}</p>}</div></div></div>
}
