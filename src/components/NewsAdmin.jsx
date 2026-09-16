import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { newsApi } from '../lib/newsApi'
import './NewsAdmin.css'
import NewsProse from './NewsProse'
import NewsPublish from './NewsPublish'
import { NewsReadiness, NewsFeedback, NewsMarketAdmin, NewsAccess, NewsRunDetails, ResearchEvidence } from './NewsOperations'

const NewsVisualGallery=lazy(()=>import('./NewsVisualGallery'))
const sections = ['connections', 'sources', 'editor', 'inbox', 'library', 'markets', 'runs', 'visuals', 'feedback', 'access']

export default function NewsAdmin({ localToken }) {
  const [data, setData] = useState(null)
  const [section, setSection] = useState(() => {
    const params=new URLSearchParams(window.location.search),view=params.get('view')
    return !params.has('draft')&&sections.includes(view)?view:'inbox'
  })
  const [sourceId, setSourceId] = useState(null)
  const [source, setSource] = useState(null)
  const [settings, setSettings] = useState(null)
  const [draftId, setDraftId] = useState(null)
  const [draftText, setDraftText] = useState('')
  const [revisionNote, setRevisionNote] = useState('')
  const [preview, setPreview] = useState(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [requestedDraftId] = useState(() => new URLSearchParams(window.location.search).get('draft'))
  const api = useCallback((path, opts) => newsApi(`/admin${path}`, { ...opts, token: localToken }), [localToken])
  const reload = useCallback(async () => { const value = await api('/overview'); setData(value); setSettings(value.settings.value); return value }, [api])
  useEffect(() => {
    let active = true
    api('/overview').then(value => {
      if (!active) return
      setData(value); setSettings(value.settings.value)
      const initial = requestedDraftId ? value.drafts.find(row => row.id === requestedDraftId) : value.drafts[0]
      if (initial) { setDraftId(initial.id); setDraftText(JSON.stringify(initial.content, null, 2)) }
      else if (requestedDraftId) setMessage('That draft is not in the recent inbox.')
    }).catch(error => { if (active) setMessage(error.message) })
    return () => { active = false }
  }, [api, requestedDraftId])
  const act = async fn => { setBusy(true); setMessage(''); try { await fn() } catch (error) { setMessage(error.message) } finally { setBusy(false) } }
  const chooseSource = row => { setSourceId(row.id); setSource(row.config); setPreview(null); setMessage('') }
  const chooseDraft = row => { setDraftId(row.id); setDraftText(JSON.stringify(row.content, null, 2)); setRevisionNote(''); setMessage('') }
  const selectedRow = data?.sources.find(row => row.id === sourceId)
  const selectedDraft = data?.drafts.find(row => row.id === draftId)
  let draftPreview = null
  try { draftPreview = JSON.parse(draftText) } catch { /* Editable JSON may be incomplete. */ }
  const saveSource = () => act(async () => {
    const row = await api(selectedRow ? `/sources/${sourceId}` : '/sources', { method: selectedRow ? 'PUT' : 'POST', body: selectedRow ? { expectedVersion: selectedRow.version, value: source } : source })
    await reload(); chooseSource(row); setMessage('saved')
  })
  const saveDraft = () => act(async () => {
    const row = await api(draftId ? `/drafts/${draftId}` : '/drafts', { method: draftId ? 'PUT' : 'POST', body: draftId ? { expectedVersion: selectedDraft.version, value: JSON.parse(draftText) } : JSON.parse(draftText) })
    await reload(); chooseDraft(row); setMessage('draft saved / not public')
  })
  return <section className="news-admin" aria-label="News administration">
    <header><h2>news / desk</h2><span>{data?.runtime.database === 'local' ? 'local database' : 'private'}</span></header>
    <nav aria-label="News admin sections">{sections.map(name => <button key={name} aria-pressed={section === name} onClick={() => { setSection(name); setMessage('') }}>{name}</button>)}</nav>
    <p role="status" className="na-status">{message || (!data ? 'connecting…' : '')}</p>
    {!data ? <button onClick={() => act(reload)}>reconnect</button> : <fieldset disabled={busy} className="na-body">
      {section==='visuals'&&<Suspense fallback={<p>loading specimens…</p>}><NewsVisualGallery/></Suspense>}
      {section === 'connections' && <NewsReadiness api={api}/>}
      {section === 'feedback' && <NewsFeedback api={api}/>}
      {section === 'access' && <NewsAccess api={api}/>}
      {section === 'sources' && <div className="na-columns">
        <aside><small>{data.sources.length} sources / {data.sources.filter(s => s.config.enabled).length} active</small>
          <button onClick={() => { setSourceId(null); setPreview(null); setSource({ id:'',name:'',family:'news',recommendation:'reserve',homepage:'',endpoint:null,adapter:'feed',pillars:['politics'],enabled:false,processing:'metadata',rightsNote:'',rightsUrl:null,cadenceMinutes:180 }) }}>+ source</button>
          {data.sources.map(row => <button className={sourceId === row.id ? 'selected' : ''} key={row.id} onClick={() => chooseSource(row)}><span>{row.config.name}</span><small>{row.config.enabled ? 'on' : row.config.recommendation}</small></button>)}
        </aside>
        <div>{source ? <>
          <h3>{source.name}</h3><p className="na-note">{source.adapter === 'pending' ? 'Connector pending. This source is in the registry, not an active integration.' : 'Preview checks access. Enable only after reviewing the source’s processing permissions.'}</p>
          {!selectedRow && <label>Stable ID<input value={source.id} onChange={e => setSource({ ...source, id:e.target.value })} placeholder="lowercase-and-dashes" /></label>}
          <label>Name<input value={source.name} onChange={e => setSource({ ...source, name: e.target.value })} /></label>
          <label>Homepage<input value={source.homepage} onChange={e => setSource({ ...source, homepage:e.target.value })} /></label>
          <div className="na-settings"><label>Family<select value={source.family} onChange={e => setSource({ ...source, family:e.target.value })}>{['news','opinion','research','markets'].map(v => <option key={v}>{v}</option>)}</select></label><label>Recommendation<select value={source.recommendation} onChange={e => setSource({ ...source, recommendation:e.target.value })}>{['start','reserve','hold'].map(v => <option key={v}>{v}</option>)}</select></label><label>Connector<select value={source.adapter} onChange={e => setSource({ ...source, adapter:e.target.value })}><option value="feed">RSS / Atom / RDF</option><option value="search">web research</option><option value="pending">pending</option></select></label></div>
          <fieldset><legend>Pillars</legend>{['macro','politics','business','tech'].map(pillar => <label className="na-check" key={pillar}><input type="checkbox" checked={source.pillars.includes(pillar)} onChange={e => setSource({ ...source, pillars:e.target.checked ? [...source.pillars,pillar] : source.pillars.filter(p => p !== pillar) })} />{pillar}</label>)}</fieldset>
          <label>Feed URL<input value={source.endpoint || ''} onChange={e => setSource({ ...source, endpoint: e.target.value || null })} /></label>
          <label>Cadence / minutes<input type="number" min="15" value={source.cadenceMinutes} onChange={e => setSource({ ...source, cadenceMinutes: Number(e.target.value) })} /></label>
          <label>Processing<select value={source.processing} onChange={e => setSource({ ...source, processing: e.target.value })}><option value="metadata">metadata only</option><option value="feed-text">permitted feed text</option></select></label>
          <label>Rights reference<input value={source.rightsUrl || ''} onChange={e => setSource({ ...source, rightsUrl: e.target.value || null })} /></label>
          <label>Access and processing notes<textarea rows="7" value={source.rightsNote} onChange={e => setSource({ ...source, rightsNote: e.target.value })} /></label>
          <label className="na-check"><input type="checkbox" checked={source.enabled} onChange={e => setSource({ ...source, enabled: e.target.checked })} />enabled</label>
          <div className="na-actions"><button onClick={saveSource}>save</button><button disabled={!selectedRow || source.adapter !== 'feed'} onClick={() => act(async () => setPreview(await api(`/sources/${sourceId}/preview`, { method: 'POST' })))}>preview saved source</button><button disabled={!selectedRow?.config.enabled} onClick={() => act(async () => { const result = await api(`/sources/${sourceId}/ingest`, { method: 'POST' }); await reload(); setMessage(`${result.count} new items`) })}>ingest</button></div>
          <p className="na-note">{selectedRow?.last_error || (selectedRow?.last_success_at ? `last read / ${new Date(selectedRow.last_success_at).toLocaleString()}` : 'not collected yet')}</p>
          {preview && <div><p>{preview.note}</p>{preview.items.map(item => <p key={item.id}><a href={item.url} target="_blank" rel="noreferrer">{item.title} ↗</a></p>)}</div>}
        </> : <p className="na-note">Select a source.</p>}</div>
      </div>}
      {section === 'editor' && settings && <div>
        <div className="na-settings">{[['mainModel','Editor model'],['helperModel','Default helpers'],['researchModel','Research helpers'],['reviewModel','Independent reviewer']].map(([key,label]) => <label key={key}>{label}<input value={settings[key] || (key==='reviewModel'?settings.researchModel:'')} onChange={e => setSettings({ ...settings, [key]:e.target.value })} /></label>)}</div><p className="na-note">A model also needs verified pricing and account access before the worker can use it.</p>
        <label>Editorial charter<textarea className="na-charter" value={settings.charter} onChange={e => setSettings({ ...settings, charter: e.target.value })} /></label>
        <label>Current priorities / temporary, not permanent rules<textarea rows="5" value={settings.priorities} onChange={e => setSettings({ ...settings, priorities: e.target.value })} /></label>
        <label className="na-check"><input type="checkbox" checked={settings.searchEnabled} onChange={e=>setSettings({...settings,searchEnabled:e.target.checked})}/>live web research</label>
        <fieldset><legend>Daily draft / never auto-publish</legend><label className="na-check"><input type="checkbox" checked={settings.schedule.enabled} onChange={e=>setSettings({...settings,schedule:{...settings.schedule,enabled:e.target.checked}})}/>enabled</label><div className="na-settings"><label>Hour<input type="number" min="0" max="23" value={settings.schedule.hour} onChange={e=>setSettings({...settings,schedule:{...settings.schedule,hour:Number(e.target.value)}})}/></label><label>Minute<input type="number" min="0" max="59" value={settings.schedule.minute} onChange={e=>setSettings({...settings,schedule:{...settings.schedule,minute:Number(e.target.value)}})}/></label><label>Time zone<input value={settings.schedule.timezone} onChange={e=>setSettings({...settings,schedule:{...settings.schedule,timezone:e.target.value}})}/></label></div></fieldset>
        <div className="na-settings">{[['targetUsd','Daily target / $'],['softUsd','Soft limit / $'],['hardUsd','Admission ceiling / $'],['dailyStoryTarget','Daily stories / soft target'],['wordsPerStory','Words per story']].map(([key,label]) => <label key={key}>{label}<input type="number" min="0" max={key==='dailyStoryTarget'?12:undefined} step={key==='dailyStoryTarget'?1:undefined} aria-describedby={key==='dailyStoryTarget'?'daily-story-target-help':undefined} value={settings[key]} onChange={e => setSettings({ ...settings, [key]: Number(e.target.value) })} /></label>)}</div>
        <p className="na-note" id="daily-story-target-help">Total deeper reads, not per category. Aim for balance; no required slots. Fewer strong stories beat filler.</p>
        <button onClick={() => act(async () => { await api('/settings', { method: 'PUT', body: { expectedVersion: data.settings.version, value: settings } }); await reload(); setMessage('editor configuration saved') })}>save editor / v{data.settings.version}</button>
      </div>}
      {section === 'inbox' && <div className="na-columns"><aside><button onClick={() => act(reload)}>refresh</button><button onClick={() => { setDraftId(null); setDraftText(JSON.stringify({ date: new Date().toISOString().slice(0,10), cutoff: new Date().toISOString(), stories: [], library: [], coverageGaps: [], rejected: [] },null,2)) }}>+ draft</button>{data.drafts.map(row => <button className={draftId===row.id?'selected':''} key={row.id} onClick={() => chooseDraft(row)}><span>{row.content.date} / {new Date(row.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}<br/>{row.content.stories.length} stories · v{row.version}</span><small>{row.status==='published'?'published':row.quality?.status?.replaceAll('_',' ')||'unreviewed'}</small></button>)}</aside>
        <div>{draftText ? <><h3>{draftPreview?.date || 'draft'}</h3>
          {selectedDraft && <details className="na-quality" open={selectedDraft.quality?.status!=='ready_for_owner'}><summary>editorial review / {JSON.stringify(draftPreview)!==JSON.stringify(selectedDraft.content)?'unsaved changes':selectedDraft.quality?.status?.replaceAll('_',' ')||'not reviewed'}</summary>
            <p>{['macro','politics','business','tech'].map(p=>`${p} ${draftPreview?.stories?.filter(s=>s.pillar===p).length||0}`).join(' / ')}</p>
            <p>{selectedDraft.quality?.review?.assessment || 'No independent editorial review is recorded for this exact version.'}</p>
            {[...(selectedDraft.quality?.checks?.problems||selectedDraft.checks?.problems||[]),...(selectedDraft.quality?.review?.editionProblems||[])].map((problem,i)=><p key={i}>{problem}</p>)}
            {selectedDraft.quality?.review?.stories?.filter(s=>s.decision!=='keep').map(s=><div key={s.storyId}><strong>{draftPreview?.stories?.find(story=>story.id===s.storyId)?.title||s.storyId} / {s.decision}</strong>{s.problems.map((p,i)=><p key={i}>{p}</p>)}<p>{s.revision}</p></div>)}
            {selectedDraft.quality?.review?.extraClaims?.filter(c=>c.decision!=='keep'||c.problems.length).map(c=><div key={c.id}><strong>{c.id} / {c.decision}</strong>{c.problems.map((p,i)=><p key={i}>{p}</p>)}</div>)}
            <small>Independent model judgment, not a guarantee. Publication is still your decision.</small>
          </details>}
          {selectedDraft?.quality?.reader && <details className="na-quality"><summary>cold-reader check / {selectedDraft.quality.reader.status}</summary>{selectedDraft.quality.reader.review.editionProblems.map((p,i)=><p key={i}>{p}</p>)}{selectedDraft.quality.reader.review.stories.map(s=><details key={s.storyId}><summary>{s.storyId}</summary><p>{s.situation}</p><p>{s.comparison}</p><p>{s.learned}</p>{[...s.missingContext,...s.visualProblems].map((p,i)=><p key={i}>{p}</p>)}</details>)}</details>}
          {!!draftPreview?.headlines?.length && <h3>elsewhere</h3>}
          {[...(draftPreview?.headlines||[]),...(draftPreview?.stories||[])].map(story => <article className="na-story" key={story.id}><small>{story.pillar}{story.eventDate ? ` / ${story.eventDate}` : ''}</small><h4>{story.title}</h4><NewsProse body={story.body} visuals={story.visuals}/>{[...(story.citations||[]),...(Array.isArray(story.visuals)?story.visuals:[]).flatMap(v=>v?.citations||[])].map((citation,index) => { if (citation.researchId) return <ResearchEvidence key={`${citation.itemId}:${citation.researchId}:${index}`} api={api} citation={citation}/>; const item = data.items.find(i => i.id === citation.itemId); return <details key={`${citation.itemId}:${index}`}><summary>{item?.publisher || citation.itemId} / evidence</summary><p>{citation.locator}</p>{item && <a href={item.canonical_url} target="_blank" rel="noreferrer">{item.title} ↗</a>}</details> })}</article>)}
          {!!draftPreview?.coverageGaps?.length && <details><summary>reporting notes / {draftPreview.coverageGaps.length}</summary>{draftPreview.coverageGaps.map((gap,i)=><p key={i}>{gap}</p>)}</details>}
          {!!draftPreview?.rejected?.length && <details><summary>not selected / {draftPreview.rejected.length}</summary>{draftPreview.rejected.map((r,i)=><p key={i}>{data.items.find(item=>item.id===r.itemId)?.title||r.itemId}<br/>{r.reason}</p>)}</details>}
          <details><summary>edit structured content</summary><textarea rows="24" aria-label="Draft JSON" value={draftText} onChange={e => setDraftText(e.target.value)} /></details>
          {selectedDraft && <details><summary>ask the editor to revise</summary><label>What should change?<textarea rows="4" maxLength={6000} value={revisionNote} onChange={e=>setRevisionNote(e.target.value)}/></label><p className="na-note">A paid revision reuses this version and its evidence. It creates a new private draft; your charter and this version stay unchanged.</p><button disabled={revisionNote.trim().length<10||JSON.stringify(draftPreview)!==JSON.stringify(selectedDraft.content)} onClick={()=>act(async()=>{await api('/runs',{method:'POST',body:{revision:{draftId,expectedVersion:selectedDraft.version,note:revisionNote.trim()}}});await reload();setRevisionNote('');setMessage('Revision queued. The new draft will appear in the inbox.')})}>prepare revision</button></details>}
          <details><summary>market selection / {draftPreview?.marketPlacements?.length||0}</summary><p className="na-note">Publishing replaces the visible selection. Quotes still come from the provider; permissions stay owner-controlled.</p>{draftPreview?.marketPlacements?.map(p=><p key={p.marketId}>{p.topic} / {p.marketId}<br/>{p.reason}</p>)}</details>
          <div className="na-actions"><button disabled={selectedDraft?.status === 'published'} onClick={saveDraft}>save draft</button></div>
          <NewsPublish key={`${draftId}:${selectedDraft?.version}`} draft={selectedDraft} dirty={JSON.stringify(draftPreview) !== JSON.stringify(selectedDraft?.content)} api={api} onBusyChange={setBusy} onPublished={() => {
            setData(current => ({ ...current, drafts: current.drafts.map(row => row.id === draftId ? { ...row, status: 'published' } : row) }))
            setMessage('published')
          }}/>
        </> : <p className="na-note">Drafts appear here. Nothing is published automatically.</p>}</div>
      </div>}
      {section === 'library' && <div><h3>collected material / private</h3><p className="na-note">Collection is not endorsement. Items enter the public library only through an approved draft.</p>{data.items.map(item => <details key={item.id}><summary>{item.publisher} / {item.title}</summary><p>{item.id} / {item.evidence_level} / {item.published_at ? new Date(item.published_at).toLocaleDateString() : 'original date unknown'}</p><p>{item.evidence || 'Metadata only. Not eligible as story evidence.'}</p><a href={item.canonical_url} target="_blank" rel="noreferrer">original ↗</a></details>)}</div>}
      {section === 'markets' && <NewsMarketAdmin api={api}/>}
      {section === 'runs' && <div><p>{data.runtime.apiKeyConfigured ? 'API key configured' : 'OpenAI API key missing'} / {data.runtime.workerConfigured ? 'worker enabled' : 'worker not connected'}</p><button disabled={!data.runtime.workerConfigured || !data.runtime.apiKeyConfigured} onClick={() => act(async () => { await api('/runs',{method:'POST'});await reload();setMessage('queued for editor') })}>prepare edition</button>{data.runs.map(run => <div className="na-story" key={run.id}><p>{run.id} / {run.status}</p><p>{run.error}</p><NewsRunDetails api={api} runId={run.id}/>{['queued','running'].includes(run.status) && <button onClick={() => act(async () => {await api(`/runs/${run.id}/cancel`,{method:'POST'});await reload()})}>cancel</button>}</div>)}<h3>daily spend / reserved + settled</h3>{data.usage.map(day => <p key={day.day}>{String(day.day).slice(0,10)} / ${Number(day.committed_usd).toFixed(2)} of ${Number(day.limit_usd).toFixed(2)}</p>)}</div>}
    </fieldset>}
  </section>
}
