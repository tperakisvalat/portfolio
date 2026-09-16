// One zero-inclusive scale per chart: negative observations cannot masquerade as
// positive bars, and unequal values cannot be drawn with incomparable baselines.
export function barLayout(values: number[]) {
  const min = Math.min(0, ...values), max = Math.max(0, ...values)
  const span = max - min || 1
  const position = (value: number) => (value - min) / span * 100
  return { zero: position(0), rows: values.map(value => ({ left: position(Math.min(0,value)), width: Math.abs(value) / span * 100 })) }
}
export function extent(values:number[],zero=false):[number,number] {
  const lo=Math.min(...values,...(zero?[0]:[])),hi=Math.max(...values,...(zero?[0]:[]))
  if(lo===hi){const padding=Math.abs(lo)*.1||1;return zero&&lo===0?[0,1]:[lo-padding,hi+padding]}
  return [lo,hi]
}
export const scaled=(value:number,domain:[number,number],start:number,end:number)=>start+(value-domain[0])/(domain[1]-domain[0])*(end-start)
export function ticks(domain:[number,number],count=5){return Array.from({length:count},(_,i)=>domain[0]+(domain[1]-domain[0])*i/(count-1))}
export function lineSegments<T extends {y:number|null}>(points:T[]) {
  const segments:T[][]=[];let current:T[]=[]
  for(const p of points){if(p.y===null){if(current.length)segments.push(current);current=[]}else current.push(p)}
  if(current.length)segments.push(current)
  return segments
}
export function waterfallRows(figure:any) {
  let total=figure.start.value
  const rows=[{label:figure.start.label,from:0,to:total,value:total,kind:'total'}]
  for(const change of figure.changes){const from=total;total+=change.value;rows.push({...change,from,to:total,kind:'change'})}
  rows.push({label:figure.endLabel,from:0,to:total,value:total,kind:'total'})
  return rows
}
export const bubbleRadius=(value:number,max:number)=>Math.sqrt(value/max)*19
export function networkEdgePath(a:{x:number;y:number},b:{x:number;y:number},reciprocal:boolean) {
  const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy),bend=reciprocal?36:0
  const p=(x:number,y:number)=>`${x.toFixed(2)},${y.toFixed(2)}`
  return `M${p(a.x+dx/length*22,a.y+dy/length*22)} Q${p((a.x+b.x)/2-dy/length*bend,(a.y+b.y)/2+dx/length*bend)} ${p(b.x-dx/length*26,b.y-dy/length*26)}`
}
export function stackedRows(figure:any) {
  const max=Math.max(...figure.rows.map((r:any)=>r.values.reduce((sum:number,v:number)=>sum+v,0)))||1
  return figure.rows.map((row:any)=>{const total=row.values.reduce((sum:number,v:number)=>sum+v,0);return {...row,total,widths:row.values.map((v:number)=>v/(figure.mode==='share'?(total||1):max)*100)}})
}
export const formatValue=(value:number)=>new Intl.NumberFormat('en',{maximumSignificantDigits:5}).format(value)
export const formatX=(x:number,format:string)=>format==='date'?new Date(x).toISOString():formatValue(x)
export const MAP_REGIONS:Record<string,[number,number,number,number]>={world:[-180,-80,180,80],europe:[-20,30,50,75],asia:[25,-15,180,80],'middle-east':[25,10,70,45],africa:[-25,-40,60,40],americas:[-180,-60,-25,80]}
export function mapPosition(lng:number,lat:number,region:string) {
  const [west,south,east,north]=MAP_REGIONS[region],merc=(v:number)=>Math.log(Math.tan(Math.PI/4+v*Math.PI/360))
  const radians=(v:number)=>v*Math.PI/180,xSpan=radians(east-west),ySpan=merc(north)-merc(south),scale=Math.min(610/xSpan,310/ySpan)
  return {x:320+(radians(lng-(west+east)/2))*scale,y:170-((merc(lat)-(merc(north)+merc(south))/2))*scale}
}
export function figureRows(figure:any):{headers:string[];rows:(string|number)[][]} {
  switch(figure.kind) {
    case 'bars':return {headers:['Category',figure.unit,'Note'],rows:figure.rows.map((r:any)=>[r.label,r.value,r.note])}
    case 'line':return {headers:['Series',`${figure.xLabel} / ${figure.xUnit}`,`${figure.yLabel} / ${figure.yUnit}`],rows:figure.series.flatMap((s:any)=>s.points.map((p:any)=>[s.label,figure.xFormat==='date'?formatX(p.x,'date'):p.x,p.y??'Missing']))}
    case 'scatter':return {headers:['Point',`${figure.xLabel} / ${figure.xUnit}`,`${figure.yLabel} / ${figure.yUnit}`,'Group',...(figure.sizeUnit?[figure.sizeUnit]:[])],rows:figure.points.map((p:any)=>[p.label,p.x,p.y,p.group||'—',...(figure.sizeUnit?[p.size]:[])])}
    case 'stacked':return {headers:['Category',...figure.segments,'Total',...(figure.mode==='share'?['Display']:[])],rows:stackedRows(figure).map((r:any)=>[r.label,...r.values,r.total,...(figure.mode==='share'?[r.total?'Share of each row':'No observations; share undefined']:[])])}
    case 'waterfall':return {headers:['Step',`Change or total / ${figure.unit}`,'Running total','Type'],rows:waterfallRows(figure).map(r=>[r.label,r.value,r.to,r.kind])}
    case 'heatmap':return {headers:['',...figure.xLabels],rows:figure.values.map((r:any[],i:number)=>[figure.yLabels[i],...r.map(v=>v??'Missing')])}
    case 'comparison':return {headers:['',...figure.columns],rows:figure.rows.map((r:any)=>[r.label,...r.values])}
    case 'map':return {headers:['Place','Latitude','Longitude','Detail'],rows:figure.points.map((p:any)=>[p.label,p.lat,p.lng,p.detail])}
    case 'network':return {headers:['From',figure.directed?'To':'Connected to','Relationship'],rows:figure.edges.map((e:any)=>[figure.nodes.find((n:any)=>n.id===e.from).label,figure.nodes.find((n:any)=>n.id===e.to).label,e.label])}
    default:return {headers:['Step','Detail'],rows:figure.steps.map((s:any)=>[s.label,s.detail])}
  }
}
export function figureText(figure:any) {
  if(['bars','flow','timeline'].includes(figure.kind))return [figure.title,...(figure.kind==='bars'?[`${figure.period} / ${figure.unit}`,...figure.rows.map((r:any)=>`${r.label}: ${r.value} ${figure.unit}${r.note?` — ${r.note}`:''}`)]:figure.steps.map((s:any)=>`${s.label}: ${s.detail}`)),figure.caption].join('\n')
  const table=figureRows(figure)
  return [figure.title,figure.period,figure.unit,table.headers.join(' / '),...table.rows.map(r=>r.join(' / ')),
    ...(figure.kind==='network'?figure.nodes.map((n:any)=>`${n.label}: ${n.detail}`):[]),
    ...(figure.annotations||[]).map((a:any)=>`${a.series}: ${a.text}`),figure.caption].filter(Boolean).join('\n')
}
