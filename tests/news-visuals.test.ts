import {test} from 'node:test'
import assert from 'node:assert/strict'
import {FigureContent} from '../shared/news-figure-schema.js'
import {StoryFigure,Draft} from '../shared/news.js'
import {visualExamples} from '../shared/news-visual-fixtures.js'
import {extent,scaled,lineSegments,bubbleRadius,waterfallRows,stackedRows,figureText,figureRows,mapPosition,networkEdgePath} from '../shared/news-visuals.js'
import {draftHash} from '../server/editorial-quality.js'
const example=(kind:string):any=>structuredClone(visualExamples.find(v=>v.kind===kind))
test('every visual specimen validates, needs evidence for a story, and has a text equivalent',()=>{
  assert.equal(visualExamples.length,11)
  for(const f of visualExamples){assert(FigureContent.safeParse(f).success);assert(!StoryFigure.safeParse(f).success);assert(StoryFigure.safeParse({...f,citations:[{itemId:'11111111-1111-4111-8111-111111111111',locator:'Fixture evidence'}]}).success);assert(figureText(f).includes(f.title));assert(figureText(f).includes(f.caption));assert(figureRows(f).rows.length)}
})
test('line spacing is numeric, gaps are not bridged, dates are milliseconds and invalid annotations fail',()=>{
  assert.equal(scaled(1,[0,10],0,100),10)
  assert.deepEqual(lineSegments([{y:1},{y:null},{y:2},{y:3}]),[[{y:1}],[{y:2},{y:3}]])
  const f=example('line');assert(f.series[0].points[0].x>1e12)
  f.series[0].points[1].x=f.series[0].points[0].x;assert(!FigureContent.safeParse(f).success)
  const bad=example('line');bad.annotations[0].pointIndex=2;assert(!FigureContent.safeParse(bad).success)
  const dates=figureRows(example('line'));assert(dates.rows.some(r=>r.some(v=>String(v).includes('2026-01-01T'))))
  const numeric=example('line');numeric.xFormat='number';numeric.series[0].points[0].x=0.1234567890123
  assert.equal(figureRows(numeric).rows[0][1],0.1234567890123)
})
test('bubbles encode area, require consistent size units, and point identities stay unique',()=>{
  assert(Math.abs(bubbleRadius(4,4)**2/bubbleRadius(1,4)**2-4)<1e-10)
  const f=example('scatter');delete f.sizeUnit;assert(!FigureContent.safeParse(f).success)
  const g=example('scatter');g.points[1].label=g.points[0].label;assert(!FigureContent.safeParse(g).success)
})
test('stacked values align to segments; zero totals and negative values cannot fabricate shares',()=>{
  const f=example('stacked');f.rows[0].values=[0,0,0];assert(FigureContent.safeParse(f).success);assert.deepEqual(stackedRows(f)[0].widths,[0,0,0]);assert(figureText(f).includes('share undefined'))
  f.rows[0].values=[1,-2,3];assert(!FigureContent.safeParse(f).success)
  f.rows[0].values=[1,2];assert(!FigureContent.safeParse(f).success)
  const absolute={...example('stacked'),mode:'absolute'};const rows=stackedRows(absolute);assert.equal(rows[1].widths.reduce((a:number,b:number)=>a+b,0),40)
  assert.deepEqual(stackedRows({...absolute,rows:[{label:'A',values:[.1,.2,.2],note:''},{label:'B',values:[.1,0,0],note:''}]})[0].widths,[20,40,40])
})
test('waterfalls reconcile losses, gains and signed totals without editor-supplied totals',()=>{
  const rows=waterfallRows(example('waterfall'));assert.equal(rows.at(-1)?.value,85);assert.equal(rows[3].from,122);assert.equal(rows[3].to,85)
  const negative={...example('waterfall'),start:{label:'Start',value:2},changes:[{label:'Loss',value:-5}]};assert.equal(waterfallRows(negative).at(-1)?.value,-3)
})
test('heatmap geometry, missing values, network references and map bounds are validated',()=>{
  const h=example('heatmap');assert(figureText(h).includes('Missing'));h.values[0]=[1];assert(!FigureContent.safeParse(h).success)
  const n=example('network');n.edges[0].to='invented';assert(!FigureContent.safeParse(n).success)
  assert(networkEdgePath({x:0,y:0},{x:100,y:0},true).includes('Q50.00,36.00'))
  assert(networkEdgePath({x:100,y:0},{x:0,y:0},true).includes('Q50.00,-36.00'),'Opposite relationships must not overlap as a single line')
  const m=example('map');m.region='europe';assert(!FigureContent.safeParse(m).success)
  const p=mapPosition(0,0,'world');assert.equal(p.x,320);assert(Math.abs(p.y-170)<1e-8)
  const east=mapPosition(1,0,'world'),north=mapPosition(0,1,'world')
  assert(Math.abs((east.x-p.x)/(p.y-north.y)-1)<.001,'Projection must not stretch east-west versus north-south at the equator')
  for(const d of [extent([0,0]),extent([-5,-5]),extent([4,4])])assert(d[1]>d[0])
})
test('unknown executable content and unsafe shapes are never valid visuals',()=>{
  for(const f of visualExamples){assert(!FigureContent.safeParse({...f,html:'<script>bad()</script>'}).success);assert(!FigureContent.safeParse({...f,kind:'iframe'}).success)}
  const f=example('scatter');f.points[0].x=NaN;assert(!FigureContent.safeParse(f).success)
})
test('legacy figure field ordering and receipt hash stay stable',()=>{
  const old={id:'legacy',afterParagraph:1,title:'Legacy chart',caption:'Existing published figure.',citations:[{itemId:'11111111-1111-4111-8111-111111111111',locator:'Existing evidence',researchId:null}],kind:'bars',unit:'jobs',period:'Original period',rows:[{label:'A',value:1,note:''},{label:'B',value:2,note:''}]}
  assert.equal(JSON.stringify(StoryFigure.parse(old)),JSON.stringify(old))
  const d=Draft.parse({date:'2026-09-08',cutoff:'2026-09-08T20:00:00.000Z',stories:[{id:'legacy',pillar:'macro',title:'Existing reviewed story',body:'Existing reviewed text with enough characters.',citations:old.citations,visuals:[old]}],library:[],coverageGaps:[],rejected:[],marketPlacements:[]})
  assert.equal(draftHash(d),draftHash(Draft.parse(JSON.parse(JSON.stringify(d)))))
})
