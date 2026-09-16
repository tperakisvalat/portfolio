import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { openDatabase, migrate, type Database } from '../server/db.js'
import { seed } from '../server/seed.js'
import { createApi } from '../server/api.js'
import { Source, Draft, Settings, readStoredSettings } from '../shared/news.js'
import { editorialPrompt } from '../server/editorial-prompt.js'
import { newsParagraphs } from '../shared/news-prose.js'
import { barLayout } from '../shared/news-visuals.js'
import { visualExamples } from '../shared/news-visual-fixtures.js'
import { readerView, coldReadDraft } from '../server/reader-review.js'
import { queueEdition, revisionAssignment } from '../server/editorial-assignment.js'
import { parseFeed, ingestSource, canonicalUrl } from '../server/feeds.js'
import { publicAddress, safeFetch } from '../server/fetch.js'
import { audit, getSettings, saveDraft, publish, updateVersioned, briefText, hash } from '../server/store.js'
import { effectiveBudget, reserve, reserveWhenAvailable, settle, upperBound, requestCostBound } from '../server/budget.js'
import { createEditorBridge, responseCost } from '../server/editor.js'
import { citedResearch, research, RESEARCH_OUTPUT_TOKENS } from '../server/research.js'
import { collectDue, dueEdition, queueScheduled } from '../server/scheduler.js'
import { runQueuedEdition, workerLoop } from '../server/worker.js'
import { normalizeMarket, publicMarkets, refreshMarkets } from '../server/markets.js'
import { proxyNews } from '../api/news-proxy.js'
import { activateStarterSources } from '../server/starter.js'
import { createExecutor } from '../server/executor.js'
import { readFile } from 'node:fs/promises'
import { parse as yaml } from 'yaml'
import { deskSnapshot } from '../server/editorial-desk.js'
import { checkpointProposal, draftHash, EditionPlan, getDraftQuality, qualityChecks, readProposal, recoverProposal, reviewDraft } from '../server/editorial-quality.js'

let db:Database, api:ReturnType<typeof createApi>, itemId:string
const fixture=Source.parse({id:'test-source',name:'Test source',family:'research',recommendation:'start',homepage:'https://example.org/',endpoint:'https://example.org/feed',adapter:'feed',pillars:['tech'],enabled:true,processing:'feed-text',rightsNote:'Local test fixture written specifically for this test suite.',rightsUrl:'https://example.org/license',cadenceMinutes:60})
const feed=`<rss><channel><item><title>Research finding</title><link>https://example.org/article?utm_source=test</link><pubDate>Mon, 07 Sep 2026 10:00:00 GMT</pubDate><description>Researchers found a measurable improvement in the controlled experiment. The result is limited to the tested population.</description></item></channel></rss>`
before(async()=>{
  const testUrl=process.env.NEWS_TEST_DATABASE_URL
  if(testUrl) {
    const target=new URL(testUrl)
    if(target.hostname!=='127.0.0.1' || target.pathname!=='/news_test')throw new Error('Tests require a disposable loopback news_test database')
  }
  db=await openDatabase(testUrl||'','memory://')
  if(testUrl && (await db.query("SELECT 1 FROM information_schema.tables WHERE table_schema='news_private'")).length)throw new Error('Refusing to test against an existing news database')
  await migrate(db);await seed(db)
  await db.query('INSERT INTO news_private.sources(id,config) VALUES($1,$2)',[fixture.id,JSON.stringify(fixture)])
  await ingestSource(db,fixture,async()=>feed)
  itemId=(await db.query<any>("SELECT id FROM news_private.items WHERE source_id='test-source'"))[0].id
  api=createApi(db,async(_db,token)=>{if(token==='owner')return{id:'owner',owner:true,scopes:['*']};if(token==='assistant')return{id:'assistant',owner:false,scopes:['read','settings:write','drafts:write','sources:write']};throw Object.assign(new Error('Invalid token'),{statusCode:401})})
})
after(async()=>{await api?.close();await db?.close()})
function draft(){return Draft.parse({date:'2026-09-07',cutoff:'2026-09-07T15:00:00.000Z',stories:[{id:'research-1',pillar:'tech',title:'A bounded research finding',body:'The controlled experiment found an improvement. Its scope is limited to the population actually studied.',citations:[{itemId,locator:'Researchers found a measurable improvement'}]}],library:[{itemId,topics:['tech:research'],annotation:'A controlled experiment with clearly stated limits.'}],coverageGaps:['Fixture only'],rejected:[]})}

test('disabled packaged workers perform no collection, scheduling or editorial work',async t=>{
  const previous=process.env.NEWS_WORKER_ENABLED
  process.env.NEWS_WORKER_ENABLED='false'
  t.after(()=>{if(previous===undefined)delete process.env.NEWS_WORKER_ENABLED;else process.env.NEWS_WORKER_ENABLED=previous})
  const controller=new AbortController();let queries=0,edits=0
  const forbidden={query:async()=>{queries++;controller.abort();return []}} as unknown as Database
  await workerLoop(forbidden,controller.signal,async()=>{edits++;throw new Error('Disabled editor was called')})
  assert.equal(queries,0);assert.equal(edits,0)
})

test('reader prose preserves paragraphs and links without accepting HTML or unsafe schemes',()=>{
  const paragraphs=newsParagraphs('Read the [original](https://example.org/paper).\n\n<script>alert(1)</script> [unsafe](javascript:alert) [private](https://user:secret@example.org/) ![image](https://example.org/a.png)')
  assert.equal(paragraphs.length,2)
  assert.deepEqual(paragraphs[0],[{text:'Read the '},{text:'original',href:'https://example.org/paper'},{text:'.'}])
  assert(paragraphs[1].every(part=>!part.href))
  assert.equal(newsParagraphs('  \n\n').length,0)
})

test('optional digest and figures preserve legacy hashes and reject unsafe or invisible figures',()=>{
  const content=draft()
  assert.equal(draftHash(content),hash(JSON.stringify(content)))
  assert(!('headlines' in content));assert(!('visuals' in content.stories[0]))
  const figure={id:'comparison',kind:'bars',afterParagraph:1,title:'Test comparison',caption:'Test values, not real-world observations.',unit:'points',period:'Test period',rows:[{label:'A',value:2,note:''},{label:'B',value:-1,note:''}],citations:content.stories[0].citations}
  assert(Draft.safeParse({...content,stories:[{...content.stories[0],visuals:[figure]}]}).success)
  for(const bad of [{...figure,afterParagraph:2},{...figure,script:'alert(1)'},{...figure,kind:'html'}, {...figure,rows:[{label:'A',value:Infinity,note:''}]}])assert(!Draft.safeParse({...content,stories:[{...content.stories[0],visuals:[bad]}]}).success)
  const visible=readerView(Draft.parse({...content,stories:[{...content.stories[0],visuals:[figure]}]}))
  assert.equal(visible.editionSummary,'1 deeper read')
  assert.deepEqual(visible.sectionOrder,['tech'])
  assert(!JSON.stringify(visible).includes('citations'));assert(!JSON.stringify(visible).includes('researchId'));assert(!JSON.stringify(visible).includes('Researchers found'))
  assert.deepEqual(barLayout([-2,6]),{zero:25,rows:[{left:0,width:25},{left:25,width:75}]})
  assert.deepEqual(barLayout([0,0]),{zero:0,rows:[{left:0,width:0},{left:0,width:0}]})
})

test('digest and figure claims require evidence and survive publication and text export without private fields',async()=>{
  assert.equal((await api.inject({url:'/api/news/v1/brief/latest'})).json().edition,null)
  const base=draft(),citation=base.stories[0].citations[0]
  const content=Draft.parse({...base,headlines:[{id:'elsewhere-fixture',pillar:'tech',title:'A second bounded development',body:'This is a test event with enough context to understand the bounded experiment.',eventDate:'2026-09-07',citations:[citation]}],stories:[{...base.stories[0],visuals:[{id:'flow-fixture',kind:'flow',afterParagraph:1,title:'How this test works',caption:'Schematic of the fixture, not empirical data.',steps:[{label:'Question',detail:'Compare a controlled result.'},{label:'Boundary',detail:'Keep the tested population explicit.'}],citations:[citation]}]}]})
  const badHeadline=structuredClone(content);badHeadline.headlines![0].citations[0].locator='NO SUCH PASSAGE'
  await assert.rejects(()=>saveDraft(db,'owner',badHeadline),/Citation passage/)
  const badFigure=structuredClone(content);badFigure.stories[0].visuals![0].citations[0].itemId=randomUUID()
  await assert.rejects(()=>saveDraft(db,'owner',badFigure),/Unknown source/)
  const saved=await saveDraft(db,'owner',content),published=await publish(db,'owner',saved.id,saved.version,randomUUID())
  assert.equal(published.content.headlines[0].sources[0].url,'https://example.org/article')
  assert.equal(published.content.stories[0].visuals[0].sources[0].itemId,itemId)
  assert(!JSON.stringify(published.content).includes('"locator":'));assert(!JSON.stringify(published.content).includes('"researchId":'))
  const text=briefText(published);assert(text.includes('elsewhere'));assert(text.includes('How this test works'));assert(text.includes('Question: Compare'))
})

test('all eleven visual kinds round-trip through publication with frozen sources and readable text',async()=>{
  const base=draft(),prototype=base.stories[0]
  const content=Draft.parse({...base,stories:[0,4,8].map((offset,index)=>({...prototype,id:`visual-story-${index}`,visuals:visualExamples.slice(offset,offset+4).map(figure=>({...figure,citations:prototype.citations}))}))})
  const saved=await saveDraft(db,'owner',content),published=await publish(db,'owner',saved.id,saved.version,randomUUID())
  const figures=published.content.stories.flatMap((story:any)=>story.visuals),text=briefText(published)
  assert.equal(figures.length,11)
  for(const figure of figures){assert.equal(figure.sources[0].url,'https://example.org/article');assert(text.includes(figure.title))}
  assert(text.includes('Missing'));assert(text.includes('Ending value'));assert(text.includes('Provides capability'));assert(text.includes('Shanghai'))
  assert(!JSON.stringify(published.content).includes('"locator":'));assert(!JSON.stringify(published.content).includes('"researchId":'))
  const [stored]=await db.query<any>('SELECT content FROM news_private.editions WHERE id=$1',[published.id])
  assert.deepEqual(stored.content,published.content)
})

test('cold reader rejects missing story assessments and conserves paid output usage',async()=>{
  const settings=await getSettings(db),id=randomUUID()
  const [run]=await db.query<any>("INSERT INTO news_private.runs(id,settings_version,settings_snapshot,status) VALUES($1,$2,$3,'running') RETURNING *",[id,settings.version,JSON.stringify(settings.value)])
  const provider=(async()=>new Response(JSON.stringify({id:'bad_reader_fixture',status:'completed',usage:{input_tokens:100,output_tokens:100},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({stories:[],editionProblems:[]})}]}]}))) as typeof fetch
  await assert.rejects(()=>coldReadDraft(db,run,draft(),{[settings.value.researchModel]:{input:2,cacheWrite:2.5,output:12}},new AbortController().signal,provider),/every story exactly once/)
  assert.equal((await db.query<any>('SELECT state FROM news_private.usage WHERE run_id=$1',[id]))[0].state,'settled')
  assert.equal((await db.query("SELECT id FROM news_private.audit WHERE entity_id=$1 AND action='editor.reader_review'",[id])).length,0)
})

test('source-aware review cannot silently skip figures or digest claims',async()=>{
  const settings=await getSettings(db),id=randomUUID(),content=draft()
  content.headlines=[{id:'headline-fixture',pillar:'tech',title:'A separate bounded finding',body:'A second controlled experiment found an improvement for the tested population.',eventDate:content.date,citations:content.stories[0].citations}]
  content.stories[0].visuals=[{id:'figure-fixture',kind:'flow',afterParagraph:1,title:'The tested mechanism',caption:'Schematic of the fixture, not a measured effect.',steps:[{label:'Experiment',detail:'Test the stated population.'},{label:'Scope',detail:'Keep the conclusion bounded.'}],citations:content.stories[0].citations}]
  const [run]=await db.query<any>("INSERT INTO news_private.runs(id,settings_version,settings_snapshot,status) VALUES($1,$2,$3,'running') RETURNING *",[id,settings.version,JSON.stringify(settings.value)])
  const provider=(async(_url:any,opts:any)=>{
    const body=JSON.parse(opts.body),reader=body.text.format.name==='cold_reader_review'
    const result=reader?{stories:content.stories.map(s=>({storyId:s.id,situation:'A controlled experiment.',comparison:'The comparison is explained.',learned:'A bounded effect.',missingContext:[],visualProblems:[]})),editionProblems:[]}:{verdict:'ready_for_owner',assessment:'This fixture wrongly ignores the non-story claims.',stories:content.stories.map(s=>({storyId:s.id,decision:'keep',learned:'A bounded effect.',problems:[],revision:''})),extraClaims:[],editionProblems:[]}
    return new Response(JSON.stringify({id:'skipped_claim_fixture',status:'completed',usage:{input_tokens:100,output_tokens:100},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]}))
  }) as typeof fetch
  await assert.rejects(()=>reviewDraft(db,run,content,{[settings.value.researchModel]:{input:2,cacheWrite:2.5,output:12}},new AbortController().signal,provider),/every headline and figure exactly once/)
  assert.equal((await db.query("SELECT id FROM news_private.audit WHERE entity_id=$1 AND action='editor.review'",[id])).length,0)
  assert((await db.query<any>('SELECT state FROM news_private.usage WHERE run_id=$1',[id])).every(v=>v.state==='settled'))
})

test('revision commissions snapshot an exact private version without changing the charter or source draft',async()=>{
  const original=await saveDraft(db,'owner',draft()),before=await getSettings(db)
  await assert.rejects(()=>queueEdition(db,'owner',{revision:{draftId:original.id,expectedVersion:99,note:'Improve the explanation using existing evidence.'}}),/Draft changed/)
  const run=await queueEdition(db,'owner',{revision:{draftId:original.id,expectedVersion:original.version,note:'Improve the explanation using existing evidence.'}})
  const assignment=await revisionAssignment(db,run.id)
  assert.equal(assignment?.cutoff,draft().cutoff)
  assert(assignment?.prompt.includes('Improve the explanation'))
  assert(assignment?.prompt.includes('not a new day'))
  await saveDraft(db,'owner',{...draft(),coverageGaps:['Later owner edit']},original.id,original.version)
  assert(!(await revisionAssignment(db,run.id))?.prompt.includes('Later owner edit'))
  const after=await getSettings(db);assert.equal(after.version,before.version);assert.deepEqual(after.value,before.value)
  assert.equal(await revisionAssignment(db,randomUUID()),null)
  const detail=await api.inject({url:`/api/news/v1/admin/runs/${run.id}`,headers:{authorization:'Bearer owner'}})
  assert.equal(detail.json().commission.kind,'revision')
  assert.equal(detail.json().commission.draftId,original.id)
  assert(!('content' in detail.json().commission));assert(!('quality' in detail.json().commission))
})
test('JSON parameters round-trip without double encoding, including arrays and scalar strings',async()=>{
  for(const value of [{nested:{ok:true},label:'quotes " and accents é'},['a',{b:2}],null,'literal string',true,42]) {
    const [row]=await db.query<any>('SELECT $1::jsonb AS value',[JSON.stringify(value)])
    assert.deepEqual(row.value,value)
  }
})
test('seed repair preserves content and versions and is idempotent',async()=>{
  const settings=(await db.query<any>("SELECT * FROM news_private.settings WHERE id='editor'"))[0]
  const source=(await db.query<any>('SELECT * FROM news_private.sources WHERE id=$1',[fixture.id]))[0]
  await db.query("UPDATE news_private.settings SET value=to_jsonb(value::text) WHERE id='editor'")
  await db.query('UPDATE news_private.sources SET config=to_jsonb(config::text) WHERE id=$1',[fixture.id])
  const repair=await readFile('supabase/migrations/20260908134121_repair_news_seed_json.sql','utf8')
  await db.exec(repair);await db.exec(repair)
  assert.deepEqual((await db.query("SELECT * FROM news_private.settings WHERE id='editor'"))[0],settings)
  assert.deepEqual((await db.query('SELECT * FROM news_private.sources WHERE id=$1',[fixture.id]))[0],source)
})
test('50 source registry entries, disabled by default; charter persists unchanged on reseed',async()=>{
  const rows=await db.query<any>('SELECT config FROM news_private.sources WHERE id<>$1',[fixture.id]);assert.equal(rows.length,50);assert(rows.every(r=>!r.config.enabled))
  const settings=await getSettings(db);assert(settings.value.charter.includes('Revolut'));assert(settings.value.charter.includes('tentative'))
  await updateVersioned(db,'owner','settings','editor',settings.version,{...settings.value,priorities:'Temporary test priority'})
  await seed(db);assert.equal((await getSettings(db)).value.priorities,'Temporary test priority')
})
test('RSS deduplicates; original dates are not replaced by retrieval time',async()=>{
  const result=await ingestSource(db,fixture,async()=>feed);assert.equal(result.count,0)
  const atom=parseFeed('<feed><entry><title>A paper</title><link href="https://example.org/atom"/><updated>2026-09-07T10:00:00Z</updated><summary>Abstract.</summary></entry></feed>',fixture)
  assert.equal(atom[0].publishedAt,null)
  assert.equal(parseFeed('<rss><channel><item><title>Embedded document</title><link>https://example.org/embed</link><description><![CDATA[<!DOCTYPE html><p>Harmless publisher HTML.</p>]]></description></item></channel></rss>',fixture).length,1)
  assert.throws(()=>parseFeed('<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss/>',fixture))
})
test('SSRF and bad schemes are rejected before outbound fetch',async()=>{
  for(const ip of ['127.0.0.1','10.1.2.3','169.254.169.254','172.16.1.1','192.168.1.1','::1','::ffff:127.0.0.1','fd00::1'])assert.equal(publicAddress(ip),false)
  assert.equal(publicAddress('8.8.8.8'),true)
  await assert.rejects(()=>safeFetch('http://example.org',['example.org']))
  await assert.rejects(()=>safeFetch('https://127.0.0.1',['127.0.0.1']))
  await assert.rejects(()=>safeFetch('https://other.org',['example.org']))
})
test('anonymous and invalid sessions cannot access admin',async()=>{
  assert.equal((await api.inject({url:'/api/news/v1/admin/overview'})).statusCode,401)
  assert.equal((await api.inject({url:'/api/news/v1/admin/overview',headers:{authorization:'Bearer stranger'}})).statusCode,401)
  const publicData=await api.inject({url:'/api/news/v1/brief/latest'});assert.equal(publicData.statusCode,200);assert(!publicData.body.includes('"locator":'));assert(!publicData.body.includes('"settings":'))
})
test('assistant cannot publish, raise cap or activate a source',async()=>{
  const headers={authorization:'Bearer assistant'}
  assert.equal((await api.inject({method:'POST',url:`/api/news/v1/admin/drafts/${randomUUID()}/publish`,headers,payload:{expectedVersion:1}})).statusCode,403)
  const settings=await getSettings(db)
  assert.equal((await api.inject({method:'PUT',url:'/api/news/v1/admin/settings',headers,payload:{expectedVersion:settings.version,value:{...settings.value,hardUsd:20}}})).statusCode,403)
  assert.equal((await api.inject({method:'PUT',url:'/api/news/v1/admin/settings',headers,payload:{expectedVersion:settings.version,value:{...settings.value,reviewModel:settings.value.mainModel}}})).statusCode,403)
  assert.equal((await api.inject({method:'PUT',url:'/api/news/v1/admin/sources/test-source',headers,payload:{expectedVersion:1,value:{...fixture,enabled:false}}})).statusCode,403)
})
test('draft validation rejects invented evidence, numeric market writes and cross-pillar tags',async()=>{
  const bad=draft();bad.stories[0].citations[0].locator='This passage does not exist';await assert.rejects(()=>saveDraft(db,'editor',bad))
  assert.throws(()=>Draft.parse({...draft(),marketProbability:70}))
  const tags=draft();tags.library[0].topics=['business:research'];assert.throws(()=>Draft.parse(tags))
  const [row]=await db.query<any>('SELECT * FROM news_private.items WHERE id=$1',[itemId])
  await db.query("UPDATE news_private.items SET evidence_level='metadata' WHERE id=$1",[itemId]);await assert.rejects(()=>saveDraft(db,'editor',draft()));await db.query('UPDATE news_private.items SET evidence_level=$2 WHERE id=$1',[itemId,row.evidence_level])
})
test('exact version, duplicate publish, immutable public projection and matching text',async()=>{
  const saved=await saveDraft(db,'editor',draft())
  await assert.rejects(()=>publish(db,'owner',saved.id,2,'stale-key'))
  const [a,b]=await Promise.all([publish(db,'owner',saved.id,1,'same-request'),publish(db,'owner',saved.id,1,'same-request')]);assert.equal(a.id,b.id)
  const latest=(await api.inject({url:'/api/news/v1/brief/latest'})).json().edition
  assert.equal(latest.id,a.id);assert(!JSON.stringify(latest).includes('Fixture only'));assert(!JSON.stringify(latest).includes('charter'))
  const text=await api.inject({url:'/news/brief.txt'});assert.equal(text.body,briefText(latest));assert(text.body.includes('https://example.org/article'))
  const library=(await api.inject({url:'/api/news/v1/library?topic=tech%3Aresearch'})).json();assert.equal(library.items.length,1)
  assert.equal((await api.inject({url:'/api/news/v1/library?topic=business%3Aeurope'})).json().items.length,0)
  await assert.rejects(()=>saveDraft(db,'owner',draft(),saved.id,1))
})

test('owner publication replaces the public brief, rejects stale versions and returns uncached matching text',async()=>{
  const first=await saveDraft(db,'owner',draft())
  const headers={authorization:'Bearer owner','idempotency-key':randomUUID()}
  const firstResponse=await api.inject({method:'POST',url:`/api/news/v1/admin/drafts/${first.id}/publish`,headers,payload:{expectedVersion:1}})
  assert.equal(firstResponse.statusCode,200)
  const nextContent=draft();nextContent.stories[0].title='A newer public edition'
  const next=await saveDraft(db,'owner',nextContent)
  await saveDraft(db,'owner',nextContent,next.id,1)
  const stale=await api.inject({method:'POST',url:`/api/news/v1/admin/drafts/${next.id}/publish`,headers:{...headers,'idempotency-key':randomUUID()},payload:{expectedVersion:1}})
  assert.equal(stale.statusCode,409);assert(stale.json().requestId)
  assert.equal((await api.inject({url:'/api/news/v1/brief/latest'})).json().edition.id,firstResponse.json().id)
  const key=randomUUID(),request={method:'POST' as const,url:`/api/news/v1/admin/drafts/${next.id}/publish`,headers:{...headers,'idempotency-key':key},payload:{expectedVersion:2}}
  const accepted=await api.inject(request),retry=await api.inject(request)
  assert.equal(accepted.statusCode,200);assert.equal(retry.json().id,accepted.json().id)
  const current=await api.inject({url:'/api/news/v1/brief/latest'}),text=await api.inject({url:'/news/brief.txt'})
  assert.equal(current.headers['cache-control'],'no-store');assert.equal(text.headers['cache-control'],'no-store')
  assert.equal(current.json().edition.id,accepted.json().id)
  assert.equal(current.json().edition.content.stories[0].title,'A newer public edition')
  assert.equal(text.body,briefText(current.json().edition))
})
test('concurrent reservations cannot overspend; unknown outcomes stay reserved',async()=>{
  const settings=await getSettings(db),run=randomUUID()
  const initial=(await db.query<any>('SELECT committed_usd FROM news_private.daily_budget'))[0]
  await db.query("INSERT INTO news_private.runs(id,settings_version,settings_snapshot,status) VALUES($1,$2,$3,'running')",[run,settings.version,JSON.stringify(settings.value)])
  const outcomes=await Promise.allSettled([reserve(db,run,'test',6,10),reserve(db,run,'test',6,10)])
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1)
  const ok=outcomes.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<string>
  await settle(db,ok.value,null);await assert.rejects(()=>reserve(db,run,'test',5,10))
  await settle(db,ok.value,1);const second=await reserve(db,run,'test',5,10);assert(second)
  await settle(db,second,0);await settle(db,second,0)
  const [budget]=await db.query<any>('SELECT committed_usd FROM news_private.daily_budget');assert(Math.abs(Number(budget.committed_usd)-Number(initial?.committed_usd||0)-1)<0.000001)
  await db.query("UPDATE news_private.runs SET status='cancelled' WHERE id=$1",[run]);await assert.rejects(()=>reserve(db,run,'test',1,10))
})
test('cost admission rejects unbounded context and unmetered tools',()=>{
  const price={input:10,output:50,cacheWrite:12.5}
  assert(upperBound({input:'hello',max_output_tokens:100},price)>0)
  assert.throws(()=>upperBound({previous_response_id:'resp_1',max_output_tokens:100},price))
  assert.throws(()=>upperBound({tools:[{type:'web_search'}],max_output_tokens:100},price))
  assert.throws(()=>upperBound({input:'a'.repeat(240000),max_output_tokens:100},price))
  const bounded={input:'a'.repeat(200000),max_output_tokens:8000}
  assert(upperBound(bounded,price)>2.9 && upperBound(bounded,price)<3.1)
})
test('budget admission waits for live reservations, retains unknown costs and supports cancellation',async()=>{
  const settings=await getSettings(db),run=randomUUID(),day='2027-03-02'
  await db.query("INSERT INTO news_private.runs(id,settings_version,settings_snapshot,status) VALUES($1,$2,$3,'running')",[run,settings.version,JSON.stringify(settings.value)])
  const first=await reserve(db,run,'test',.4,.5,day)
  const options={day,pollMs:5,waitMs:1000}
  const next=reserveWhenAvailable(db,run,'test',.3,.5,new AbortController().signal,options)
  await settle(db,first,.1)
  const second=await next
  await settle(db,second,null)
  await assert.rejects(()=>reserveWhenAvailable(db,run,'test',.2,.5,new AbortController().signal,options),/budget/)
  await settle(db,second,0)
  const third=await reserve(db,run,'test',.3,.5,day),controller=new AbortController()
  const aborted=assert.rejects(()=>reserveWhenAvailable(db,run,'test',.2,.5,controller.signal,options),/abort/i)
  controller.abort();await aborted
  await settle(db,third,0)
})
test('large text requests use provider token counts and fail closed if counting fails',async()=>{
  const body={model:'gpt-6-astra',input:'a'.repeat(280000),text:{format:{type:'text'}},max_output_tokens:8000},price={input:10,cacheWrite:12.5,output:50},signal=new AbortController().signal
  let calls=0
  const count=(async(url:any,opts:any)=>{calls++;assert.equal(url,'https://api.openai.com/v1/responses/input_tokens');const payload=JSON.parse(opts.body);assert.deepEqual(payload.input,body.input);assert.deepEqual(payload.text,body.text);assert(!('max_output_tokens' in payload));return new Response(JSON.stringify({object:'response.input_tokens',input_tokens:50000}))}) as typeof fetch
  assert.equal(await requestCostBound(body,price,signal,count),upperBound(body,price,50000));assert.equal(calls,1)
  await assert.rejects(()=>requestCostBound({...body,previous_response_id:'hidden'},price,signal,count));assert.equal(calls,1)
  await assert.rejects(()=>requestCostBound(body,price,signal,(async()=>new Response('{}',{status:503})) as typeof fetch),/generation was not started/)
  await assert.rejects(()=>requestCostBound(body,price,signal,(async()=>new Response(JSON.stringify({object:'response.input_tokens',input_tokens:-1}))) as typeof fetch),/Invalid token count/)
  assert.throws(()=>upperBound(body,price,240000),/Context exceeds/)
})
test('editor broker meters different helper models and hides the provider key',async()=>{
  const settings=await getSettings(db),runId=randomUUID()
  const [run]=await db.query<any>("INSERT INTO news_private.runs(id,settings_version,settings_snapshot,status) VALUES($1,$2,$3,'running') RETURNING *",[runId,settings.version,JSON.stringify(settings.value)])
  const prices={'gpt-6-astra':{input:10,output:50,cacheWrite:12.5,cachedInput:1},'gpt-5.6-luna':{input:.2,output:1.2,cacheWrite:.25,cachedInput:.02}}
  let calls=0
  const mockFetch=(async(_url:any,options:any)=>{
    calls++;const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.service_tier,'default')
    return new Response(JSON.stringify({id:`resp_${calls}`,usage:{input_tokens:100,output_tokens:20,input_tokens_details:{cached_tokens:10}},output:[]}),{status:200,headers:{'Content-Type':'application/json'}})
  }) as typeof fetch
  const bridge=await createEditorBridge(db,run,'run-only',new AbortController().signal,prices,mockFetch)
  try {
    assert.equal((await bridge.inject({method:'POST',url:'/v1/responses',payload:{}})).statusCode,401)
    for(const model of Object.keys(prices))assert.equal((await bridge.inject({method:'POST',url:'/v1/responses',headers:{authorization:'Bearer run-only'},payload:{model,input:'test',stream:false}})).statusCode,200)
    assert.equal(calls,2)
    const usage=await db.query<any>('SELECT model,state FROM news_private.usage WHERE run_id=$1',[runId]);assert.equal(usage.length,2);assert(usage.every(u=>u.state==='settled'))
    assert.equal((await bridge.inject({method:'POST',url:'/v1/responses',headers:{authorization:'Bearer run-only'},payload:{model:'unapproved',input:'test'}})).statusCode,422)
    assert.equal(calls,2)
    assert.equal(responseCost(undefined,prices['gpt-6-astra']),null)
  } finally {await bridge.close()}
})
test('schema is discoverable to an authorized assistant; draft-first controls are explicit',async()=>{
  const result=await api.inject({url:'/api/news/v1/admin/schema',headers:{authorization:'Bearer assistant'}})
  assert.equal(result.statusCode,200);assert(result.json().draft);assert(result.json().topics.politics.includes('france'))
  const allowed=result.json().draft.properties.library.items.properties.topics.items.enum
  assert(allowed.includes('macro:growth'));assert(allowed.includes('tech:research'))
  assert(!allowed.includes('growth'));assert(!allowed.includes('macro:employment'))
  assert.equal(result.json().editionRequest.properties.revision.properties.note.maxLength,6000)
})
test('RLS denies private rows even if a browser role accidentally receives table grants',async()=>{
  await db.exec('CREATE ROLE news_test_anon; GRANT USAGE ON SCHEMA news_private TO news_test_anon; GRANT SELECT ON news_private.sources,news_private.drafts,news_private.editions TO news_test_anon')
  await db.transaction(async tx=>{
    await tx.exec('SET LOCAL ROLE news_test_anon')
    for(const table of ['sources','drafts','editions'])assert.equal((await tx.query(`SELECT * FROM news_private.${table}`)).length,0)
  })
})
test('terminal usage reconciles without waiting for socket close; MCP exposes no publication tools',{timeout:3000},async()=>{
  const settings=await getSettings(db),id=randomUUID()
  const [run]=await db.query<any>("INSERT INTO news_private.runs(id,settings_version,settings_snapshot,status) VALUES($1,$2,$3,'running') RETURNING *",[id,settings.version,JSON.stringify(settings.value)])
  const price={'gpt-6-astra':{input:10,output:50,cacheWrite:12.5,cachedInput:1}}
  const event={type:'response.completed',response:{id:'streamed',usage:{input_tokens:50,output_tokens:10},output:[]}}
  let streamCancelled=false
  const provider=(async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(`event: response.completed\ndata: ${JSON.stringify(event)}\n\n`))},cancel(){streamCancelled=true}}),{headers:{'Content-Type':'text/event-stream'}})) as typeof fetch
  const bridge=await createEditorBridge(db,run,'stream-token',new AbortController().signal,price,provider)
  try {
    const response=await bridge.inject({method:'POST',url:'/v1/responses',headers:{authorization:'Bearer stream-token'},payload:{model:'gpt-6-astra',input:'text',stream:true,max_output_tokens:100}})
    assert.equal(response.statusCode,200);assert(response.body.includes('response.completed'));assert.equal(streamCancelled,true)
    const [usage]=await db.query<any>('SELECT state FROM news_private.usage WHERE run_id=$1',[id]);assert.equal(usage.state,'settled')
    const tools=await bridge.inject({method:'POST',url:'/mcp',headers:{authorization:'Bearer stream-token',accept:'application/json, text/event-stream'},payload:{jsonrpc:'2.0',id:1,method:'tools/list',params:{}}})
    assert.equal(tools.statusCode,200);assert(tools.body.includes('read_evidence'));assert(!tools.body.includes('publish_edition'));assert(!tools.body.includes('update_settings'))
  } finally {await bridge.close()}
})

test('live research preserves source-specific report passages and never invents original dates',async()=>{
  const settings=await getSettings(db),id=randomUUID()
  const [run]=await db.query<any>("INSERT INTO news_private.runs(id,settings_version,settings_snapshot,status) VALUES($1,$2,$3,'running') RETURNING *",[id,settings.version,JSON.stringify(settings.value)])
  const report='A controlled experiment found improvements in a narrow task. [source]\n\nThe adoption evidence remains preliminary. [other]'
  const annotations=[{type:'url_citation',url:'https://example.net/paper',title:'New experiment',start_index:report.indexOf('[source]'),end_index:report.indexOf('[source]')+8},{type:'url_citation',url:'https://example.net/adoption',title:'Adoption study',start_index:report.indexOf('[other]'),end_index:report.length}]
  const provider=(async(_url:any,opts:any)=>{
    const body=JSON.parse(opts.body);assert.equal(body.model,'gpt-5.6-terra');assert.equal(body.max_tool_calls,2);assert.equal(body.max_output_tokens,RESEARCH_OUTPUT_TOKENS);assert.equal(body.tool_choice,'auto');assert.equal(body.store,false);assert(!body.input.includes(settings.value.charter))
    return new Response(JSON.stringify({id:'search_fixture',status:'completed',usage:{input_tokens:2000,output_tokens:200},output:[{type:'web_search_call',action:{type:'search'}},{type:'message',content:[{type:'output_text',text:report,annotations}]}]}))
  }) as typeof fetch
  const result=await research(db,run,{query:'Find the original research and its limitations'}, {'gpt-5.6-terra':{input:2,output:12,cacheWrite:2.5}},new AbortController().signal,provider)
  const content=draft();content.stories[0].citations=[{itemId:result.sources[0].itemId,researchId:result.researchId,locator:'A controlled experiment found improvements'}]
  const saved=await saveDraft(db,'editor',content);assert(saved.id)
  const [item]=await db.query<any>('SELECT * FROM news_private.items WHERE id=$1',[result.sources[0].itemId]);assert.equal(item.published_at,null);assert.equal(item.evidence,null)
  content.stories[0].citations[0].locator='The adoption evidence remains preliminary'
  await assert.rejects(()=>saveDraft(db,'editor',content),/attributed to that source/)
  const [usage]=await db.query<any>('SELECT state FROM news_private.usage WHERE run_id=$1',[run.id]);assert.equal(usage.state,'settled')
})
test('scheduled dates respect local midnight and repeated DST hours, and queue exactly once',async()=>{
  const schedule={enabled:true,hour:1,minute:30,timezone:'America/New_York'}
  assert.equal(dueEdition(schedule,new Date('2026-11-01T05:31:00Z')),dueEdition(schedule,new Date('2026-11-01T06:31:00Z')))
  assert.equal(dueEdition({...schedule,hour:7,minute:0},new Date('2026-09-08T10:59:00Z')),null)
  assert.equal(dueEdition({...schedule,hour:7,minute:0},new Date('2026-09-08T11:00:00Z')),'2026-09-08@America/New_York')
  const old=await getSettings(db);await updateVersioned(db,'owner','settings','editor',old.version,{...old.value,schedule})
  const results=await Promise.all([queueScheduled(db,new Date('2026-11-01T05:31:00Z')),queueScheduled(db,new Date('2026-11-01T06:31:00Z'))])
  assert.equal(results.filter(Boolean).length,1)
  const current=await getSettings(db);await updateVersioned(db,'owner','settings','editor',current.version,{...current.value,schedule:{...schedule,enabled:false}})
})
test('market normalization preserves zero, exact outcomes, resolution and missing prices',async()=>{
  const quote=normalizeMarket('polymarket',{id:'123',question:'Question?',active:true,acceptingOrders:true,outcomes:'["Yes","No"]',outcomePrices:'["0","1"]'},'123')
  assert.equal(quote.outcomes[0].probability,0);assert.equal(quote.outcomes[1].probability,1)
  assert.throws(()=>normalizeMarket('polymarket',{id:'124'},'123'))
  assert.equal(normalizeMarket('kalshi',{market:{ticker:'KXTEST',market_type:'binary',status:'settled',last_price_dollars:null}},'KXTEST').outcomes[0].probability,null)
  const id=randomUUID();await db.query("INSERT INTO news_private.market_links(id,provider,external_id,topic,enabled,permission_reference,quote,checked_at) VALUES($1,'polymarket','123','macro:rates',true,'Local test permission fixture, not actual provider data',$2,now()-interval '1 hour')",[id,JSON.stringify(quote)])
  const visible=await publicMarkets(db,'macro:rates');assert.equal(visible.items[0].quote,null);assert.equal(visible.items[0].stale,true)
})
test('starter installation preserves later edits and never re-enables a disabled source',async()=>{
  assert.equal((await activateStarterSources(db)).installed,true)
  const [row]=await db.query<any>("SELECT * FROM news_private.sources WHERE id='chinatalk'")
  await updateVersioned(db,'owner','sources',row.id,row.version,{...row.config,enabled:false})
  assert.equal((await activateStarterSources(db)).installed,false)
  assert.equal((await db.query<any>("SELECT config FROM news_private.sources WHERE id='chinatalk'"))[0].config.enabled,false)
})
test('assistant cannot schedule spending, grant market rights, or inspect connection secrets',async()=>{
  const settings=await getSettings(db),headers={authorization:'Bearer assistant'}
  assert.equal((await api.inject({method:'PUT',url:'/api/news/v1/admin/settings',headers,payload:{expectedVersion:settings.version,value:{...settings.value,schedule:{...settings.value.schedule,enabled:true}}}})).statusCode,403)
  assert.equal((await api.inject({method:'POST',url:'/api/news/v1/admin/markets',headers,payload:{}})).statusCode,403)
  assert.equal((await api.inject({url:'/api/news/v1/admin/readiness',headers})).statusCode,403)
  assert.equal((await api.inject({method:'POST',url:'/api/news/v1/admin/feedback',headers,payload:{text:'More original work; fewer recaps.'}})).statusCode,200)
})
test('executor authenticates calls, deduplicates job IDs, refuses concurrent jobs and accepts cancellation',async()=>{
  const prior=process.env.NEWS_EXECUTOR_TOKEN;process.env.NEWS_EXECUTOR_TOKEN='fixture-executor'
  let finish:(v:any)=>void=()=>{},calls=0,executionSignal:AbortSignal|undefined
  const executor=createExecutor(async(_input,signal)=>{calls++;executionSignal=signal;return new Promise(resolve=>{finish=resolve})})
  const id=randomUUID(),settings=(await getSettings(db)).value,headers={authorization:'Bearer fixture-executor'}
  const payload={id,token:'x'.repeat(40),settings,prompt:'x'.repeat(95000)}
  try {
    assert.equal((await executor.inject({url:'/health'})).statusCode,401)
    const tooLarge=await executor.inject({method:'POST',url:'/jobs',headers,payload:{...payload,prompt:'x'.repeat(180001)}})
    assert.equal(tooLarge.statusCode,422);assert.equal(calls,0);assert(!tooLarge.body.includes(payload.token))
    assert.equal((await executor.inject({method:'POST',url:'/jobs',headers,payload})).statusCode,202)
    assert.equal((await executor.inject({method:'POST',url:'/jobs',headers,payload})).statusCode,200)
    assert.equal((await executor.inject({method:'POST',url:'/jobs',headers,payload:{...payload,id:randomUUID()}})).statusCode,409)
    assert.equal((await executor.inject({method:'POST',url:`/jobs/${id}/cancel`,headers:{...headers,'content-type':'application/json'},payload:{}})).statusCode,200)
    assert.equal(executionSignal?.aborted,true)
    finish(draft());await new Promise(resolve=>setTimeout(resolve,5));assert.equal(calls,1)
    assert.equal((await executor.inject({url:`/jobs/${id}`,headers})).json().status,'completed')
  }finally{await executor.close();if(prior===undefined)delete process.env.NEWS_EXECUTOR_TOKEN;else process.env.NEWS_EXECUTOR_TOKEN=prior}
})
test('packaged executor has no provider/database secrets, external network or writable host mounts',async()=>{
  const config=yaml(await readFile('compose.news.yaml','utf8')),executor=config.services.executor
  assert.deepEqual(executor.networks,['agent']);assert.equal(config.networks.agent.internal,true)
  assert.equal(executor.read_only,true);assert(!executor.ports);assert(!executor.volumes)
  assert(!executor.environment.OPENAI_API_KEY);assert(!executor.environment.DATABASE_URL)
  assert.deepEqual(config.services.desk.ports,['127.0.0.1:8080:8080'])
  const dockerignore=await readFile('.dockerignore','utf8');assert(dockerignore.startsWith('**'));assert(!dockerignore.includes('!.env'))
})
test('temporary filesystem options remain a single absolute mount per service',async()=>{
  const config=yaml(await readFile('compose.news.yaml','utf8'))
  // An unquoted comma in a YAML flow list turns mode=1777 into another mount path.
  for(const [name,size] of [['desk','64m'],['executor','256m']]) {
    assert.deepEqual(config.services[name].tmpfs,[`/tmp:size=${size},mode=1777`])
  }
})
test('owner-created assistant keys are hashed, scoped and revocable; public responses never expose them',async()=>{
  const headers={authorization:'Bearer owner'}
  const created=await api.inject({method:'POST',url:'/api/news/v1/admin/tokens',headers,payload:{name:'fixture assistant'}})
  assert.equal(created.statusCode,200)
  const data=created.json();assert(data.token.length>=32)
  const [saved]=await db.query<any>('SELECT * FROM news_private.service_tokens WHERE id=$1',[data.id]);assert.notEqual(saved.token_hash,data.token);assert(!saved.scopes.includes('publish'))
  const list=await api.inject({url:'/api/news/v1/admin/tokens',headers});assert(!list.body.includes(data.token));assert(!list.body.includes('token_hash'))
  assert.equal((await api.inject({method:'POST',url:`/api/news/v1/admin/tokens/${data.id}/revoke`,headers})).statusCode,200)
  assert((await db.query<any>('SELECT revoked_at FROM news_private.service_tokens WHERE id=$1',[data.id]))[0].revoked_at)
})
test('editor market placements can select approved contracts but cannot create prices or permissions',async()=>{
  const content=draft();content.marketPlacements=[{marketId:randomUUID(),topic:'tech:models',reason:'Relevant to the question'}]
  await assert.rejects(()=>saveDraft(db,'editor',content),/owner-approved/)
  const id=randomUUID();await db.query("INSERT INTO news_private.market_links(id,provider,external_id,topic,enabled,permission_reference) VALUES($1,'polymarket','fixture123','macro:rates',true,'Fixture permission record; not a real provider contract')",[id])
  content.marketPlacements[0].marketId=id
  const saved=await saveDraft(db,'editor',content);await publish(db,'owner',saved.id,1,'market-selection-fixture')
  const [link]=await db.query<any>('SELECT selected,topic FROM news_private.market_links WHERE id=$1',[id]);assert.equal(link.selected,true);assert.equal(link.topic,'tech:models')
  assert.throws(()=>Draft.parse({...content,marketPlacements:[{...content.marketPlacements[0],probability:0.9}]}))
})

test('processing upgrades backfill permitted feed evidence without changing original dates',async()=>{
  const source={...fixture,id:'backfill-source',processing:'metadata' as const}
  await db.query('INSERT INTO news_private.sources(id,config) VALUES($1,$2)',[source.id,JSON.stringify(source)])
  const xml=feed.replace('https://example.org/article','https://example.org/backfill')
  await ingestSource(db,source,async()=>xml)
  const [before]=await db.query<any>('SELECT * FROM news_private.items WHERE source_id=$1',[source.id]);assert.equal(before.evidence,null)
  await ingestSource(db,{...source,processing:'feed-text'},async()=>xml.replace('07 Sep 2026','08 Sep 2026'))
  const [after]=await db.query<any>('SELECT * FROM news_private.items WHERE source_id=$1',[source.id])
  assert(after.evidence.includes('controlled experiment'));assert.equal(String(after.published_at),String(before.published_at));assert.equal(after.id,before.id)
  await ingestSource(db,source,async()=>xml)
  assert.equal((await db.query<any>('SELECT evidence FROM news_private.items WHERE id=$1',[before.id]))[0].evidence,null)
})

test('feed entities and tracking variants normalize without losing meaningful URL parameters',()=>{
  assert.equal(canonicalUrl('https://example.org/article?utm_source=feed&amp;utm_medium=rss&traffic_source=rss&article=7'),'https://example.org/article?article=7')
  assert.equal(canonicalUrl('https://example.org/article?amp%3Butm_medium=rss'),'https://example.org/article')
  const [parsed]=parseFeed(feed.replace('Research finding','France&#8217;s research &amp; policy'),fixture)
  assert.equal(parsed.title,'France’s research & policy')
})

test('balanced desk includes slow research despite a high-volume publisher and excludes future items',async()=>{
  for(const [id,pillars] of [['fast-wire',['tech','politics']],['slow-science',['tech']]] as const)await db.query('INSERT INTO news_private.sources(id,config) VALUES($1,$2)',[id,JSON.stringify({...fixture,id,pillars:[...pillars]})])
  for(let i=0;i<30;i++)await db.query("INSERT INTO news_private.items(id,source_id,canonical_url,title,published_at,evidence_level,content_hash,kind) VALUES($1,'fast-wire',$2,$3,'2026-09-08T12:00:00Z','metadata','fixture','news')",[randomUUID(),`https://example.org/fast/${i}`,`Fast headline ${i}`])
  await db.query("INSERT INTO news_private.items(id,source_id,canonical_url,title,published_at,evidence_level,content_hash,kind) VALUES($1,'slow-science','https://example.org/slow','Important slow research','2026-09-04T12:00:00Z','metadata','fixture','research')",[randomUUID()])
  await db.query("INSERT INTO news_private.items(id,source_id,canonical_url,title,published_at,evidence_level,content_hash,kind) VALUES($1,'slow-science','https://example.org/future','Future finding','2026-09-09T12:00:00Z','metadata','fixture','research')",[randomUUID()])
  const snapshot=await deskSnapshot(db,'2026-09-08T15:00:00Z')
  assert(snapshot.pillars.tech.some(c=>c.title==='Important slow research'))
  assert.equal(snapshot.pillars.tech.filter(c=>c.source_id==='fast-wire').length,5)
  assert(!JSON.stringify(snapshot).includes('Future finding'))
})

test('commissioning considers all pillars without forcing candidates or story quotas',async()=>{
  const candidate={question:'Which incentive actually changed?',leads:['https://example.org/lead'],whyNow:'A new decision was announced.',reportingNeeded:'Verify the decision and its scope.'}
  assert.throws(()=>EditionPlan.parse({pillars:Array.from({length:4},()=>({pillar:'tech',candidates:[candidate,candidate]})),omissionsToCheck:[]}))
  const settings=(await getSettings(db)).value,content=draft()
  assert.equal(qualityChecks(content,settings).counts.tech,1)
  assert.equal(qualityChecks(content,settings).problems.length,0)
  const plan={pillars:['macro','politics','business','tech'].map(pillar=>({pillar,candidates:pillar==='tech'?[candidate]:[],coverageNote:'Checked the current leads; none earns depth today.'})),omissionsToCheck:[]}
  assert(EditionPlan.safeParse(plan).success)
  assert(!EditionPlan.safeParse({...plan,pillars:plan.pillars.map(p=>({...p,coverageNote:undefined}))}).success)
  content.stories[0].body+=' This is a summary-level reading; the full methods were not inspected.'
  assert(qualityChecks(content,settings).problems.some(p=>p.includes('reporting-process')))
  const old=draftHash(content);content.stories[0].body+=' Changed.';assert.notEqual(draftHash(content),old)
})

test('daily target replaces the per-pillar setting while historical snapshots stay readable',async()=>{
  const current=await getSettings(db),{dailyStoryTarget,...rest}=current.value
  const old={...rest,storiesPerPillar:2},before=JSON.stringify(old)
  assert.equal(readStoredSettings(old).dailyStoryTarget,8)
  assert.equal(JSON.stringify(old),before)
  assert.equal(readStoredSettings({...old,storiesPerPillar:1}).dailyStoryTarget,4)
  assert.equal(readStoredSettings({...old,storiesPerPillar:0}).dailyStoryTarget,0)
  assert(!Settings.safeParse(old).success)
  assert.throws(()=>readStoredSettings({...old,storiesPerPillar:'2'}))
  assert(!Settings.safeParse({...current.value,dailyStoryTarget:13}).success)
  const schema=(await api.inject({url:'/api/news/v1/admin/schema',headers:{authorization:'Bearer assistant'}})).json().settings
  assert(schema.properties.dailyStoryTarget)
  assert(!schema.properties.storiesPerPillar)
  const saved=await api.inject({method:'PUT',url:'/api/news/v1/admin/settings',headers:{authorization:'Bearer owner'},payload:{expectedVersion:current.version,value:{...current.value,dailyStoryTarget:8}}})
  assert.equal(saved.statusCode,200)
  assert.equal(saved.json().version,current.version+1)
  const prompt=editorialPrompt({...current.value,dailyStoryTarget:8},'2026-09-10T12:00:00.000Z')
  assert(prompt.includes('8 distinct, worthwhile deeper stories TOTAL'))
  assert(prompt.includes('NO per-pillar minimum or maximum'))
  assert(!prompt.includes('at least two serious candidate questions per pillar'))
})

test('uneven editions and empty pillars validate, publish and export without filler headings',async()=>{
  const base=draft(),settings=(await getSettings(db)).value
  for(const mix of [['tech','tech','tech','tech','macro','politics','business'],['tech','tech','tech','tech','macro','macro','business','business'],Array(12).fill('tech')]){
    const content=Draft.parse({...base,stories:mix.map((pillar,i)=>({...base.stories[0],id:`mix-${mix.length}-${i}`,title:`A distinct fixture finding ${i}`,pillar}))})
    assert.equal(qualityChecks(content,settings).problems.length,0)
    assert.equal(qualityChecks(content,settings).target,8)
    assert.equal(qualityChecks(content,settings).total,mix.length)
    const saved=await saveDraft(db,'test',content),edition=await publish(db,'owner',saved.id,saved.version,randomUUID())
    assert.equal(edition.content.stories.length,mix.length)
    const text=briefText(edition)
    for(const p of ['macro','politics','business','tech'])assert.equal(text.split('\n').includes(p),mix.includes(p))
  }
  assert(!Draft.safeParse({...base,stories:Array.from({length:13},(_,i)=>({...base.stories[0],id:`over-${i}`}))}).success)
})

test('independent review can approve seven strong stories with four Tech and no Politics',async()=>{
  const settings=await getSettings(db),base=draft(),mix=['tech','tech','tech','tech','macro','macro','business']
  const content=Draft.parse({...base,stories:mix.map((pillar,i)=>({...base.stories[0],id:`flex-${i}`,title:`Another distinct fixture ${i}`,pillar}))})
  const [run]=await db.query<any>("INSERT INTO news_private.runs(id,settings_version,settings_snapshot,status) VALUES($1,$2,$3,'running') RETURNING *",[randomUUID(),settings.version,JSON.stringify(settings.value)])
  let calls=0
  const provider=(async(_url:any,options:any)=>{
    calls++;const body=JSON.parse(options.body),context=JSON.parse(body.input),cold=body.text.format.name==='cold_reader_review'
    if(!cold){assert.equal(context.dailyStoryTarget,8);assert(!('requestedStoriesPerPillar' in context));assert(body.instructions.includes('no per-pillar minimum or maximum'));assert.equal(context.checks.counts.politics,0)}
    const result=cold?{stories:content.stories.map(s=>({storyId:s.id,situation:'A clear fixture situation.',comparison:'A supported comparison.',learned:'The explanation is complete.',missingContext:[],visualProblems:[]})),editionProblems:[]}:{verdict:'ready_for_owner',assessment:'Fixture judgments accept the deliberate uneven selection.',stories:content.stories.map(s=>({storyId:s.id,decision:'keep',learned:'A supported insight.',problems:[],revision:''})),extraClaims:[],editionProblems:[]}
    return new Response(JSON.stringify({id:`flex-review-${calls}`,status:'completed',usage:{input_tokens:1000,output_tokens:200},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]}))
  }) as typeof fetch
  const result=await reviewDraft(db,run,content,{[settings.value.reviewModel||settings.value.researchModel]:{input:1,output:1,cacheWrite:1}},new AbortController().signal,provider)
  assert.equal(result.status,'ready_for_owner');assert.equal(calls,2)
})

test('independent review is metered, cached by exact content, and cannot approve missing reader context',async()=>{
  const settings=await getSettings(db),id=randomUUID(),content=draft()
  const [run]=await db.query<any>("INSERT INTO news_private.runs(id,settings_version,settings_snapshot,status) VALUES($1,$2,$3,'running') RETURNING *",[id,settings.version,JSON.stringify({...settings.value,reviewModel:settings.value.mainModel})])
  let calls=0
  const provider=(async(_url:any,opts:any)=>{
    calls++;const body=JSON.parse(opts.body);assert.equal(body.model,settings.value.mainModel);assert.equal(body.store,false);assert(!body.tools)
    assert(body.input.includes('controlled experiment'));assert(body.instructions.includes('UNTRUSTED DATA'))
    const context=JSON.parse(body.input)
    if(body.text.format.name==='cold_reader_review') {
      assert(!('charter' in context));assert(!JSON.stringify(context).includes('Researchers found a measurable improvement'))
      const reader={stories:content.stories.map(s=>({storyId:s.id,situation:'A controlled experiment.',comparison:'Not explained.',learned:'A task-specific result.',missingContext:['The actual comparison is not explained.'],visualProblems:[]})),editionProblems:[]}
      return new Response(JSON.stringify({id:'reader_fixture',status:'completed',usage:{input_tokens:1000,output_tokens:200},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(reader)}]}]}))
    }
    assert.equal(context.assignment,'same-day replacement edition')
    assert.equal(context.libraryMetadata[0].publisher,'Test source')
    assert.equal(context.libraryMetadata[0].itemId,content.library[0].itemId)
    assert(body.instructions.includes('do NOT require new developments'))
    assert(body.instructions.includes('out-of-schema'))
    const review={verdict:'ready_for_owner',assessment:'Fixture reviewer incorrectly says this is ready.',stories:content.stories.map(s=>({storyId:s.id,decision:'keep',learned:'A task-specific improvement, not a general deployment result.',problems:[],revision:''})),extraClaims:[],editionProblems:[]}
    return new Response(JSON.stringify({id:'review_fixture',status:'completed',usage:{input_tokens:2000,output_tokens:300},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(review)}]}]}))
  }) as typeof fetch
  const prices={[settings.value.mainModel]:{input:10,cacheWrite:12.5,output:50}},signal=new AbortController().signal
  const report=await reviewDraft(db,run,content,prices,signal,provider)
  assert.equal(report.status,'needs_revision');assert.equal(calls,2)
  assert.equal(report.reader.status,'needs_revision')
  assert.deepEqual(await reviewDraft(db,run,content,prices,signal,provider),report);assert.equal(calls,2)
  const saved=await saveDraft(db,'editor',content)
  await audit(db,'test','draft.quality',saved.id,null,report)
  assert.equal((await getDraftQuality(db,saved.id,content)).status,'needs_revision')
  content.stories[0].body+=' Another sentence.'
  assert.equal(await getDraftQuality(db,saved.id,content),null)
  assert.equal((await db.query<any>('SELECT state FROM news_private.usage WHERE run_id=$1',[id]))[0].state,'settled')
  const publicData=(await api.inject({url:'/api/news/v1/brief/latest'})).body
  assert(!publicData.includes('Fixture reviewer'))
  const unauthenticated=await api.inject({url:`/api/news/v1/admin/runs/${id}`})
  assert.equal(unauthenticated.statusCode,401)
  const runDetails=await api.inject({url:`/api/news/v1/admin/runs/${id}`,headers:{authorization:'Bearer owner'}})
  assert.equal(runDetails.statusCode,200)
  assert(runDetails.json().editorial.some((entry:any)=>entry.action==='editor.review'))
  assert(!runDetails.json().editorial.some((entry:any)=>entry.action==='editor.proposal'))
  assert(!runDetails.json().editorial.some((entry:any)=>entry.action==='editor.review_input'))
  const [reviewInput]=await db.query<any>("SELECT after_value FROM news_private.audit WHERE entity_id=$1 AND action='editor.review_input'",[id])
  assert.equal(reviewInput.after_value.request.model,settings.value.mainModel)
  assert.equal(reviewInput.after_value.contentHash,report.contentHash)
  assert(!JSON.stringify(reviewInput.after_value).includes('Authorization'))
  const reviewStage=runDetails.json().metrics.stages.find((s:any)=>s.phase==='review')
  assert.equal(reviewStage.calls,1)
  assert.equal(reviewStage.inputTokens,2000)
  assert.equal(runDetails.json().metrics.stages.find((s:any)=>s.phase==='reader').calls,1)
})

test('discovery routes to the cheaper model; deep research has a bounded larger allowance',async()=>{
  const settings=await getSettings(db),id=randomUUID()
  const [run]=await db.query<any>("INSERT INTO news_private.runs(id,settings_version,settings_snapshot,status) VALUES($1,$2,$3,'running') RETURNING *",[id,settings.version,JSON.stringify(settings.value)])
  const prices={[settings.value.researchModel]:{input:2,cacheWrite:2.5,output:12},[settings.value.helperModel]:{input:.2,cacheWrite:.25,output:1.2}}
  const report='A source describes the scope of the finding. [source]'
  let expectedModel=settings.value.helperModel,expectedCalls=2
  const provider=(async(_url:any,opts:any)=>{
    const body=JSON.parse(opts.body);assert.equal(body.model,expectedModel);assert.equal(body.max_tool_calls,expectedCalls)
    assert(body.instructions.includes('untrusted data'));assert(body.input.includes('Edition cutoff'))
    return new Response(JSON.stringify({id:'mode_fixture',status:'completed',usage:{input_tokens:500,output_tokens:100},output:[{type:'web_search_call'},{type:'message',content:[{type:'output_text',text:report,annotations:[{type:'url_citation',url:'https://example.net/mode',title:'Mode fixture',start_index:report.indexOf('[source]'),end_index:report.length}]}]}]}))
  }) as typeof fetch
  const scan=await research(db,run,{query:'Find distinct leads in this pillar',mode:'scan'},prices,new AbortController().signal,provider)
  assert.equal(scan.evidenceType,'discovery-only')
  const scannedDraft=draft();scannedDraft.stories[0].citations=[{itemId:scan.sources[0].itemId,researchId:scan.researchId,locator:report}]
  await assert.rejects(()=>saveDraft(db,'editor',scannedDraft),/Discovery scans are leads/)
  expectedModel=settings.value.researchModel;expectedCalls=4
  const investigated=await research(db,run,{query:'Investigate the original finding and its scope',mode:'investigate',depth:'deep'},prices,new AbortController().signal,provider)
  scannedDraft.stories[0].citations[0].researchId=investigated.researchId
  assert.equal((await saveDraft(db,'editor',scannedDraft)).status,'draft')
  const usage=await db.query<any>('SELECT model,state FROM news_private.usage WHERE run_id=$1',[id]);assert.equal(usage.length,2);assert(usage.every(v=>v.state==='settled'))
})

test('incomplete independent reviews cannot create approval and still settle actual usage',async()=>{
  const settings=await getSettings(db),id=randomUUID()
  const [run]=await db.query<any>("INSERT INTO news_private.runs(id,settings_version,settings_snapshot,status) VALUES($1,$2,$3,'running') RETURNING *",[id,settings.version,JSON.stringify(settings.value)])
  const provider=(async()=>new Response(JSON.stringify({id:'incomplete_review',status:'incomplete',usage:{input_tokens:100,output_tokens:100},output:[]}))) as typeof fetch
  await assert.rejects(()=>reviewDraft(db,run,draft(),{[settings.value.researchModel]:{input:2,cacheWrite:2.5,output:12}},new AbortController().signal,provider),/no approval recorded/)
  assert.equal((await db.query('SELECT id FROM news_private.audit WHERE entity_id=$1 AND action=$2',[id,'editor.review'])).length,0)
  assert.equal((await db.query<any>('SELECT state FROM news_private.usage WHERE run_id=$1',[id]))[0].state,'settled')
  const recovered=await recoverProposal(db,run,new Error('Fixture executor interrupted'))
  assert(recovered);assert.equal(recovered.status,'draft')
  const quality=await getDraftQuality(db,recovered.id,recovered.content)
  assert.equal(quality.status,'unreviewed');assert.equal(quality.recovered,true)
  await db.query("UPDATE news_private.runs SET status='cancelled' WHERE id=$1",[id])
  assert.equal(await recoverProposal(db,run,new Error('Cancelled')),null)
})

test('Markdown citations are accepted only for URLs in actual provider search sources',()=>{
  const report='The controlled result improved. [Original](https://example.org/paper?utm_source=search)\n\nAn unsupported claim. [Invented](https://example.net/fake)'
  const output=[{type:'web_search_call',status:'completed',action:{sources:[{url:'https://example.org/paper'}]}},{type:'message',content:[{type:'output_text',text:report,annotations:[]}]}]
  const parsed=citedResearch({output})
  assert.equal(parsed.cited.length,1)
  assert.equal(parsed.cited[0].url,'https://example.org/paper')
  assert.equal(parsed.cited[0].origin,'provider-grounded-markdown')
  assert(parsed.cited[0].passage.includes('controlled result'))
  assert(!parsed.cited[0].passage.includes('unsupported'))
  assert.equal(citedResearch({output:output.slice(1)}).cited.length,0)
})

test('plain-source URLs are grounded without requiring a Markdown citation style',()=>{
  const report='Payrolls rose but sector gains were concentrated. [BLS archived release: https://www.bls.gov/news.release/archives/empsit_09042026.htm]\n\nUnsupported. https://example.net/invented'
  const output=[{type:'web_search_call',status:'completed',action:{type:'open_page',url:'https://www.bls.gov/news.release/archives/empsit_09042026.htm'}},{type:'message',content:[{type:'output_text',text:report,annotations:[]}]}]
  const result=citedResearch({output})
  assert.equal(result.cited.length,1);assert(result.cited[0].passage.includes('sector gains'))
  assert.equal(result.cited[0].origin,'provider-grounded-url')
  assert.equal(citedResearch({output:[{...output[0],status:'failed'},output[1]]}).cited.length,0)
  const suffix={type:'message',content:[{type:'output_text',text:'Fake attribution https://www.bls.gov/news.release/archives/empsit_09042026.htm?invented=true',annotations:[]}]}
  assert.equal(citedResearch({output:[output[0],suffix]}).cited.length,0)
})

test('overlapping native and Markdown citations retain one exact passage per source and paragraph',()=>{
  const url='https://example.org/result'
  const first=`The measured result improved. ([Original](${url}))`
  const second=`A separate limitation matters. ([Original](${url}))`
  const report=`${first}\n\n${second}`
  const parsed=citedResearch({output:[{type:'web_search_call',status:'completed',action:{sources:[{url}]}},{type:'message',content:[{type:'output_text',text:report,annotations:[{type:'url_citation',url,title:'Original',start_index:first.indexOf('[Original]'),end_index:first.length}]}]}]})
  assert.equal(parsed.cited.length,2)
  assert.equal(parsed.cited[0].passage,first)
  assert(parsed.cited[1].passage.includes('separate limitation'))
  for(const citation of parsed.cited)assert(report.includes(citation.passage))
})

test('rejected uncited research is retained privately, charged, and never accepted as evidence',async()=>{
  const settings=await getSettings(db),id=randomUUID()
  const [run]=await db.query<any>("INSERT INTO news_private.runs(id,settings_version,settings_snapshot,status) VALUES($1,$2,$3,'running') RETURNING *",[id,settings.version,JSON.stringify(settings.value)])
  const provider=(async()=>new Response(JSON.stringify({id:'uncited_fixture',status:'completed',usage:{input_tokens:500,output_tokens:100},output:[{type:'web_search_call'},{type:'message',content:[{type:'output_text',text:'Useful looking but ungrounded. [Invented](https://example.net/not-a-returned-source)',annotations:[]}]}]}))) as typeof fetch
  await assert.rejects(()=>research(db,run,{query:'Read this original and report the evidence',mode:'scan'},{[settings.value.helperModel]:{input:.2,cacheWrite:.25,output:1.2}},new AbortController().signal,provider),/rejected report saved privately/)
  assert.equal((await db.query('SELECT id FROM news_private.research WHERE run_id=$1',[id])).length,0)
  const [record]=await db.query<any>("SELECT after_value FROM news_private.audit WHERE entity_id=$1 AND action='editor.research_rejected'",[id])
  assert(record.after_value.report.includes('ungrounded'))
  assert.equal((await db.query<any>('SELECT state FROM news_private.usage WHERE run_id=$1',[id]))[0].state,'settled')
})

test('receipt handoff retrieves the exact checkpoint only within its run and retains review on recovery',async()=>{
  const settings=await getSettings(db),id=randomUUID(),content=draft()
  const [run]=await db.query<any>("INSERT INTO news_private.runs(id,settings_version,settings_snapshot,status) VALUES($1,$2,$3,'running') RETURNING *",[id,settings.version,JSON.stringify(settings.value)])
  const receipt=await checkpointProposal(db,run,content)
  assert.deepEqual(await readProposal(db,id,receipt.contentHash),content)
  await assert.rejects(()=>readProposal(db,randomUUID(),receipt.contentHash),/No checkpointed proposal/)
  await assert.rejects(()=>readProposal(db,id,'b'.repeat(64)),/No checkpointed proposal/)
  const report={contentHash:receipt.contentHash,status:'needs_revision',checks:qualityChecks(content,settings.value)}
  await audit(db,'fixture','editor.review',id,null,report)
  const recovered=await recoverProposal(db,run,new Error('Handoff budget limit'))
  assert.equal((await getDraftQuality(db,recovered.id,recovered.content)).status,'needs_revision')
  assert.equal(recovered.status,'draft')
})

test('owner testing allowance expires by budget date, preserves normal settings and cannot be granted by assistant',async()=>{
  const settings=await getSettings(db),id=randomUUID(),day=new Date().toISOString().slice(0,10)
  const payload={day,targetUsd:30,softUsd:50,hardUsd:60,reason:'Owner explicitly approved a one-day commissioning test.'}
  const url='/api/news/v1/admin/budget/allowance'
  assert.equal((await api.inject({method:'POST',url,headers:{authorization:'Bearer assistant'},payload})).statusCode,403)
  const approved=await api.inject({method:'POST',url,headers:{authorization:'Bearer owner'},payload})
  assert.equal(approved.statusCode,200)
  assert.deepEqual((await getSettings(db)),settings)
  assert.equal((await effectiveBudget(db,settings.value,day)).hardUsd,60)
  const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10)
  assert.equal((await effectiveBudget(db,settings.value,tomorrow)).hardUsd,settings.value.hardUsd)
  assert.equal((await effectiveBudget(db,settings.value,tomorrow)).temporary,false)
  await db.query("INSERT INTO news_private.runs(id,settings_version,settings_snapshot,status) VALUES($1,$2,$3,'running')",[id,settings.version,JSON.stringify(settings.value)])
  const reservation=await reserve(db,id,settings.value.mainModel,11,10,day)
  await settle(db,reservation,0)
  await assert.rejects(()=>reserve(db,id,settings.value.mainModel,61,10,day),/Daily budget/)
  assert.equal((await api.inject({method:'POST',url,headers:{authorization:'Bearer owner'},payload:{...payload,day:tomorrow}})).statusCode,422)
  await api.inject({method:'POST',url,headers:{authorization:'Bearer owner'},payload:{...payload,targetUsd:6,softUsd:8,hardUsd:10,reason:'End the local fixture testing allowance.'}})
})

// These fixtures live only in the disposable test database. Close prior test
// runs so queue tests cannot accidentally claim a different test's commission.
async function idleQueue() {
  await db.query("UPDATE news_private.runs SET status='cancelled' WHERE status IN ('queued','running')")
}
const noSignal=()=>new AbortController().signal

test('two workers claim a single edition once and leave the resulting draft private',async()=>{
  await idleQueue()
  const previous=await api.inject({url:'/api/news/v1/brief/latest'})
  const run=await queueEdition(db,'owner',{});let calls=0
  const editor=async()=>{calls++;return saveDraft(db,'fixture-editor',draft())}
  await Promise.all([runQueuedEdition(db,randomUUID(),noSignal(),editor),runQueuedEdition(db,randomUUID(),noSignal(),editor)])
  assert.equal(calls,1)
  const [saved]=await db.query<any>('SELECT status,draft_id FROM news_private.runs WHERE id=$1',[run.id])
  assert.equal(saved.status,'review');assert(saved.draft_id)
  assert.equal((await db.query<any>('SELECT status FROM news_private.drafts WHERE id=$1',[saved.draft_id]))[0].status,'draft')
  assert.deepEqual((await api.inject({url:'/api/news/v1/brief/latest'})).json(),previous.json())
})

test('restart expires an abandoned lease without replaying its model call or freeing uncertain spend',async()=>{
  await idleQueue()
  const lost=await queueEdition(db,'owner',{}),next=await queueEdition(db,'owner',{})
  await db.query("UPDATE news_private.runs SET status='running',worker_id=$2,lease_until=now()-interval '5 minutes' WHERE id=$1",[lost.id,randomUUID()])
  const usage=await reserve(db,lost.id,'fixture',0.1,10)
  await settle(db,usage,null)
  const seen:string[]=[]
  await runQueuedEdition(db,randomUUID(),noSignal(),async(_db,run)=>{seen.push(run.id);return saveDraft(db,'fixture-editor',draft())})
  assert.deepEqual(seen,[next.id])
  assert.equal((await db.query<any>('SELECT status FROM news_private.runs WHERE id=$1',[lost.id]))[0].status,'failed')
  assert.equal((await db.query<any>('SELECT state FROM news_private.usage WHERE id=$1',[usage]))[0].state,'unknown')
})

test('stopping or cancelling an edition cannot accidentally mark it ready for review',async()=>{
  await idleQueue()
  const controller=new AbortController(),untouched=await queueEdition(db,'owner',{})
  controller.abort()
  await runQueuedEdition(db,randomUUID(),controller.signal,async()=>{throw new Error('Must not start')})
  assert.equal((await db.query<any>('SELECT status FROM news_private.runs WHERE id=$1',[untouched.id]))[0].status,'queued')
  await idleQueue()
  const stopped=await queueEdition(db,'owner',{}),stop=new AbortController()
  await runQueuedEdition(db,randomUUID(),stop.signal,async()=>{stop.abort();return {id:randomUUID()}})
  assert.equal((await db.query<any>('SELECT status FROM news_private.runs WHERE id=$1',[stopped.id]))[0].status,'failed')
  const cancelled=await queueEdition(db,'owner',{})
  await runQueuedEdition(db,randomUUID(),noSignal(),async()=>{
    await api.inject({method:'POST',url:`/api/news/v1/admin/runs/${cancelled.id}/cancel`,headers:{authorization:'Bearer owner'}})
    return {id:randomUUID()}
  })
  assert.equal((await db.query<any>('SELECT status FROM news_private.runs WHERE id=$1',[cancelled.id]))[0].status,'cancelled')
})

test('losing a worker lease aborts its editor and cannot overwrite another worker', {timeout:5000},async()=>{
  await idleQueue()
  const run=await queueEdition(db,'owner',{}),replacement=randomUUID()
  await runQueuedEdition(db,randomUUID(),noSignal(),async(_db,_run,signal)=>{
    await db.query('UPDATE news_private.runs SET worker_id=$2 WHERE id=$1',[run.id,replacement])
    assert(signal)
    if(!signal.aborted)await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}))
    assert(signal.aborted)
    return {id:randomUUID()}
  },10)
  const [state]=await db.query<any>('SELECT status,worker_id FROM news_private.runs WHERE id=$1',[run.id])
  assert.equal(state.status,'running');assert.equal(state.worker_id,replacement)
  await idleQueue()
})

test('a broken feed does not block other feeds; shutdown stops further collection',async()=>{
  await db.query("UPDATE news_private.sources SET last_checked_at=NULL WHERE config->>'enabled'='true'")
  const controller=new AbortController(),seen:string[]=[]
  const results=await collectDue(db,async(_db,source)=>{
    seen.push(source.id)
    if(seen.length===1)throw new Error('Fixture publisher unavailable')
    controller.abort();return {skipped:false,count:1}
  },controller.signal)
  assert.equal(seen.length,2);assert.equal(results.length,2)
  assert.equal(results[0].error,'Fixture publisher unavailable');assert('count' in results[1]);assert.equal(results[1].count,1)
  assert.deepEqual(await collectDue(db,async()=>{throw new Error('Do not fetch')},controller.signal),[])
})

test('a market outage retains private history but never displays stale prices as live',async()=>{
  await db.query('UPDATE news_private.market_links SET enabled=false')
  const id=randomUUID()
  await db.query("INSERT INTO news_private.market_links(id,provider,external_id,topic,enabled,selected,permission_reference,public_url,quote,checked_at) VALUES($1,'kalshi','FIXTURE','macro:growth',true,true,$2,'https://kalshi.com/markets/fixture',$3,now()-interval '20 minutes')",[id,'Synthetic test approval; not a real contract or permission.',JSON.stringify({title:'Old test quote',outcomes:[{label:'Yes',probability:0.4}]})])
  await refreshMarkets(db,async()=>{throw new Error('Fixture network outage')})
  const output=await publicMarkets(db)
  assert.equal(output.items[0].stale,true);assert.equal(output.items[0].quote,null)
  const [stored]=await db.query<any>('SELECT quote,error FROM news_private.market_links WHERE id=$1',[id])
  assert.equal(stored.quote.title,'Old test quote');assert.equal(stored.error,'Fixture network outage')
  const controller=new AbortController();controller.abort()
  await refreshMarkets(db,async()=>{assert.fail('Shutdown must not fetch')},controller.signal)
})

test('production authentication requires the verified owner, rejects local keys and user-editable claims',async t=>{
  const env={NODE_ENV:'production',NEWS_LOCAL_DESK:'false',NEWS_LOCAL_ADMIN_TOKEN:'fixture-local-key',NEWS_WORKER_ENABLED:'false',NEWS_OWNER_ID:randomUUID(),VITE_SUPABASE_URL:'https://fixture.supabase.co',VITE_SUPABASE_ANON_KEY:'fixture-public-key',NEWS_WEB_ORIGIN:'https://tpv.world'}
  const previous=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]))
  Object.assign(process.env,env)
  t.after(()=>{for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value})
  t.mock.method(globalThis,'fetch',async(url:any,opts:any)=>{
    assert.equal(url,'https://fixture.supabase.co/auth/v1/user');assert.equal(opts.headers.apikey,'fixture-public-key')
    const token=opts.headers.Authorization
    if(token==='Bearer fixture-owner')return Response.json({id:env.NEWS_OWNER_ID})
    if(token==='Bearer fixture-stranger')return Response.json({id:randomUUID(),user_metadata:{owner:true,id:env.NEWS_OWNER_ID}})
    if(token==='Bearer fixture-outage')throw new Error('private provider error must not escape')
    return Response.json({error:'invalid token'},{status:401})
  })
  const production=createApi(db);t.after(()=>production.close())
  const url='/api/news/v1/admin/settings'
  for(const [token,status] of [['fixture-local-key',401],['fixture-stranger',403],['fixture-outage',500]]) {
    const response=await production.inject({method:'PUT',url,headers:{authorization:`Bearer ${token}`,origin:'https://tpv.world'},payload:{}})
    assert.equal(response.statusCode,status);assert(!response.body.includes('private provider'))
  }
  const owner=await production.inject({url:'/api/news/v1/admin/schema',headers:{authorization:'Bearer fixture-owner'}})
  assert.equal(owner.statusCode,200)
  const [beforeQueue]=await db.query<any>('SELECT count(*) AS count FROM news_private.runs')
  const paused=await production.inject({method:'POST',url:'/api/news/v1/admin/runs',headers:{authorization:'Bearer fixture-owner',origin:'https://tpv.world'},payload:{}})
  assert.equal(paused.statusCode,503);assert(paused.json().requestId)
  assert.equal((await db.query<any>('SELECT count(*) AS count FROM news_private.runs'))[0].count,beforeQueue.count)
  const hostile=await production.inject({method:'PUT',url,headers:{authorization:'Bearer fixture-owner',origin:'https://attacker.example'},payload:{}})
  assert.equal(hostile.statusCode,403)
  assert.equal((await production.inject({url:'/api/news/v1/brief/latest'})).statusCode,200)
})

test('same-origin proxy carries owner publication into public JSON, library and text without leaking draft fields',async t=>{
  const previous=process.env.NEWS_BACKEND_URL,previousOrigin=process.env.NEWS_WEB_ORIGIN
  process.env.NEWS_BACKEND_URL='https://fixture-news.example';process.env.NEWS_WEB_ORIGIN='https://tpv.world'
  t.after(()=>{
    if(previous===undefined)delete process.env.NEWS_BACKEND_URL;else process.env.NEWS_BACKEND_URL=previous
    if(previousOrigin===undefined)delete process.env.NEWS_WEB_ORIGIN;else process.env.NEWS_WEB_ORIGIN=previousOrigin
  })
  const upstream:typeof fetch=async(input:any,init:any)=>{
    const target=new URL(String(input))
    assert.equal(target.origin,'https://fixture-news.example')
    const response=await api.inject({url:target.pathname+target.search,method:init.method,headers:Object.fromEntries(init.headers),...(init.body?{payload:Buffer.from(init.body)}:{})})
    return new Response(response.body,{status:response.statusCode,headers:{'content-type':String(response.headers['content-type'])}})
  }
  const content=draft();content.stories[0].title='End-to-end synthetic edition'
  const saved=await saveDraft(db,'fixture-editor',content)
  const key=randomUUID(),publishRequest=()=>new Request(`https://tpv.world/api/news-proxy?newsPath=v1/admin/drafts/${saved.id}/publish`,{method:'POST',headers:{authorization:'Bearer owner','idempotency-key':key,'content-type':'application/json',origin:'https://tpv.world'},body:JSON.stringify({expectedVersion:saved.version})})
  const receipt=await (await proxyNews(publishRequest(),upstream)).json()
  assert(receipt.id)
  const retry=await (await proxyNews(publishRequest(),upstream)).json();assert.equal(retry.id,receipt.id)
  const publicRead=await proxyNews(new Request('https://tpv.world/api/news-proxy?newsPath=v1/brief/latest'),upstream)
  assert.equal(publicRead.headers.get('cache-control'),'no-store')
  const latest=await publicRead.json();assert.equal(latest.edition.id,receipt.id)
  assert.equal(latest.edition.content.stories[0].title,content.stories[0].title)
  for(const hidden of ['coverageGaps','rejected','locator','researchId','charter'])assert(!JSON.stringify(latest).includes(`"${hidden}"`))
  const text=await proxyNews(new Request('https://tpv.world/api/news-proxy?newsPath=brief.txt'),upstream)
  assert.equal(await text.text(),briefText(latest.edition))
  const library=await (await proxyNews(new Request('https://tpv.world/api/news-proxy?newsPath=v1/library&topic=tech%3Aresearch'),upstream)).json()
  assert(library.items.some((item:any)=>item.id===itemId))
})
