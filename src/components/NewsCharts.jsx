import { useEffect, useId, useRef, useState } from 'react'
import { bubbleRadius, extent, figureRows, formatValue, formatX, lineSegments, networkEdgePath, scaled, stackedRows, ticks, waterfallRows } from '../../shared/news-visuals'
import NewsFigureMap from './NewsFigureMap'

const COLORS=['#88ccff','#ffba86','#bcacf6','#6fe0b4','#ed91ad']
const T=26
const axisNumber=value=>Math.abs(value)>=100000?new Intl.NumberFormat('en',{notation:'compact',maximumSignificantDigits:3}).format(value):Math.abs(value)>0&&Math.abs(value)<.001?value.toExponential(1):new Intl.NumberFormat('en',{maximumSignificantDigits:4}).format(value)

// Reflow the coordinate system, not just a desktop screenshot shrunk to a phone.
function usePlotWidth(){
  const ref=useRef(null),[width,setWidth]=useState(640)
  useEffect(()=>{
    if(!ref.current||typeof ResizeObserver==='undefined')return
    const observer=new ResizeObserver(([entry])=>{if(entry.contentRect.width>0)setWidth(Math.max(240,Math.round(entry.contentRect.width)))})
    observer.observe(ref.current);return()=>observer.disconnect()
  },[])
  return [ref,width]
}

export function FigureTable({figure}) {
  const data=figureRows(figure)
  return <div className="nf-table-scroll" tabIndex={0} role="region" aria-label={`${figure.title}, exact data`}><table className="nf-table"><caption>{figure.title}{figure.period?` / ${figure.period}`:''}{figure.unit?` / ${figure.unit}`:''}</caption><thead><tr>{data.headers.map((h,i)=><th key={i} scope="col">{h}</th>)}</tr></thead><tbody>{data.rows.map((row,i)=><tr key={i}>{row.map((v,j)=>j===0?<th key={j} scope="row">{v}</th>:<td key={j}>{v}</td>)}</tr>)}</tbody></table></div>
}

function activate(event,callback){if(event.key==='Enter'||event.key===' '){event.preventDefault();callback()}}
function Dot({x,y,r=4,color=COLORS[0],label,active,onSelect}) {
  return <g role="button" tabIndex={0} aria-label={label} aria-pressed={active} onMouseEnter={onSelect} onFocus={onSelect} onClick={onSelect} onKeyDown={e=>activate(e,onSelect)} className={`nf-point ${active?'is-active':''}`}>
    <title>{label}</title><circle cx={x} cy={y} r={Math.max(15,r+4)} fill="transparent"/><circle className="nf-dot" cx={x} cy={y} r={r} fill={color} fillOpacity=".65" stroke={color}/>{active&&<circle cx={x} cy={y} r={r+4} fill="none" stroke="white"/>}
  </g>
}

function Axes({xDomain,yDomain,xFormat='number',left,right,bottom,width}) {
  const tickX=v=>xFormat==='date'?(xDomain[1]-xDomain[0]<172800000?new Date(v).toISOString().slice(11,16)+'Z':new Date(v).toISOString().slice(0,10)):formatValue(v)
  const count=width<340?2:width<440?3:4
  return <g className="nf-axes" aria-hidden="true">{ticks(yDomain).map((v,i)=><g key={i}><line x1={left} x2={right} y1={scaled(v,yDomain,bottom,T)} y2={scaled(v,yDomain,bottom,T)}/><text x={left-8} y={scaled(v,yDomain,bottom,T)+4} textAnchor="end">{axisNumber(v)}</text></g>)}{ticks(xDomain,count).map((v,i)=><g key={i}><text x={scaled(v,xDomain,left,right)} y={bottom+24} textAnchor={i===0?'start':i===count-1?'end':'middle'}>{xFormat==='date'?tickX(v):axisNumber(v)}</text></g>)}</g>
}

function Plot({figure}) {
  const [active,setActive]=useState(null),[highlight,setHighlight]=useState(null)
  const [plotRef,width]=usePlotWidth(),height=width<440?290:340,left=60,right=width-28,bottom=height-56
  const line=figure.kind==='line',all=line?figure.series.flatMap(s=>s.points):figure.points
  const xDomain=extent(all.map(p=>p.x)),yDomain=extent(all.filter(p=>p.y!==null).map(p=>p.y),line&&figure.yBaseline==='zero')
  const x=v=>scaled(v,xDomain,left,right),y=v=>scaled(v,yDomain,bottom,T)
  const labels=line?figure.series.map(s=>s.label):[...new Set(figure.points.map(p=>p.group||'Observations'))]
  const maxSize=!line&&figure.sizeUnit?Math.max(...figure.points.map(p=>p.size)):1
  const describe=(p,series)=>`${p.label||series} / ${figure.xLabel}: ${formatX(p.x,line?figure.xFormat:'number')} ${figure.xUnit} / ${figure.yLabel}: ${formatValue(p.y)} ${figure.yUnit}${p.size!=null?` / ${formatValue(p.size)} ${figure.sizeUnit}`:''}`
  return <>
    <div className="nf-axis-label">{figure.yLabel} <span>/ {figure.yUnit}</span></div>
    <div ref={plotRef}><svg className="nf-plot" viewBox={`0 0 ${width} ${height}`} aria-label={figure.title}>
      <Axes xDomain={xDomain} yDomain={yDomain} xFormat={line?figure.xFormat:'number'} left={left} right={right} bottom={bottom} width={width}/>
      {line?figure.series.map((series,si)=><g key={series.label} opacity={highlight&&highlight!==series.label?'.2':'1'}>
        {lineSegments(series.points).map((segment,i)=><polyline key={i} points={segment.map(p=>`${x(p.x)},${y(p.y)}`).join(' ')} fill="none" stroke={COLORS[si]} strokeWidth="2"/>)}
        {series.points.map((p,pi)=>p.y===null?null:<Dot key={pi} x={x(p.x)} y={y(p.y)} color={COLORS[si]} label={describe(p,series.label)} active={active?.id===`${si}-${pi}`} onSelect={()=>setActive({id:`${si}-${pi}`,text:describe(p,series.label)})}/>)}
      </g>):[...figure.points].sort((a,b)=>(b.size||1)-(a.size||1)).map(p=>{const group=p.group||'Observations',color=COLORS[labels.indexOf(group)];return <g key={p.label} opacity={highlight&&highlight!==group?'.2':'1'}><Dot x={x(p.x)} y={y(p.y)} r={p.size?bubbleRadius(p.size,maxSize):5} color={color} label={describe(p,group)} active={active?.id===p.label} onSelect={()=>setActive({id:p.label,text:describe(p,group)})}/></g>})}
      {line&&(figure.annotations||[]).map((a,i)=>{const p=figure.series.find(s=>s.label===a.series).points[a.pointIndex];return <g key={i} aria-hidden="true"><line x1={x(p.x)} x2={x(p.x)} y1={y(p.y)} y2={Math.max(T,y(p.y)-22)} stroke="#fff" strokeDasharray="3 3"/><text x={x(p.x)} y={Math.max(T,y(p.y)-26)} textAnchor="middle" fill="#fff" fontSize="12">{i+1}</text></g>})}
    </svg></div>
    <div className="nf-axis-label nf-axis-label--x">{figure.xLabel} <span>/ {figure.xUnit}</span></div>
    <div className="nf-legend" aria-label="Highlight a series">{labels.map((label,i)=><button type="button" key={label} aria-pressed={highlight===label} onClick={()=>setHighlight(highlight===label?null:label)} style={{'--series-color':COLORS[i]}}><i/>{label}</button>)}</div>
    <div className="nf-inspect" role="status">{active?.text||'Point to a dot, tap it, or use Tab to inspect.'}</div>
    {line?<small className="nf-baseline">{figure.yBaseline==='zero'?'Y axis includes zero.':'Y axis fitted to the observed range; not necessarily zero.'} Missing observations break the line.</small>:<small className="nf-baseline">Axes show the observed range; association is not causation.{figure.sizeUnit?' Bubble area represents '+figure.sizeUnit+'.':''}</small>}
    {!!figure.annotations?.length&&<ol className="nf-annotations">{figure.annotations.map((a,i)=><li key={i}>{a.text}</li>)}</ol>}
  </>
}

function Stacked({figure}) {
  const [active,setActive]=useState(null)
  return <><div className="nf-legend">{figure.segments.map((s,i)=><span key={s} style={{'--series-color':COLORS[i]}}><i/>{s}</span>)}</div>{stackedRows(figure).map(row=><div className="nf-row" key={row.label}><div className="nf-row-label"><span>{row.label}</span><strong>{formatValue(row.total)} {figure.unit}</strong></div><div className="nf-stack">{row.values.map((v,i)=><button type="button" key={i} style={{width:`${row.widths[i]}%`,background:COLORS[i]}} aria-label={`${row.label}, ${figure.segments[i]}: ${v} ${figure.unit}`} onMouseEnter={()=>setActive(`${row.label} / ${figure.segments[i]}: ${formatValue(v)} ${figure.unit}${row.total?` · ${formatValue(v/row.total*100)}% of row`:''}`)} onFocus={()=>setActive(`${row.label} / ${figure.segments[i]}: ${formatValue(v)} ${figure.unit}`)} onClick={()=>setActive(`${row.label} / ${figure.segments[i]}: ${formatValue(v)} ${figure.unit}`)}/>)}{row.total===0&&<span className="nf-no-value">Zero total{figure.mode==='share'?' / share undefined':''}</span>}</div>{row.note&&<small>{row.note}</small>}</div>)}<div className="nf-inspect" role="status">{active||'Select a segment to inspect its contribution.'}</div><small className="nf-baseline">{figure.mode==='share'?'Each nonzero row is normalized to 100%; totals may differ.':'Common zero baseline; bar length represents the total.'}</small></>
}

function Waterfall({figure}) {
  const rows=waterfallRows(figure),domain=extent(rows.flatMap(r=>[r.from,r.to]),true),[active,setActive]=useState(null)
  return <><div className="nf-waterfall">{rows.map((r,i)=>{const lo=scaled(Math.min(r.from,r.to),domain,0,100),width=scaled(Math.max(r.from,r.to),domain,0,100)-lo;return <button type="button" className="nf-waterfall-row" key={i} onClick={()=>setActive(`${r.label}: ${r.kind==='change'?'change':'total'} ${r.value} ${figure.unit}; running total ${r.to}`)}><span>{r.label}</span><span className="nf-waterfall-track"><i className="nf-zero" style={{left:`${scaled(0,domain,0,100)}%`}}/><i className={`nf-waterfall-bar ${r.kind==='total'?'is-total':r.value<0?'is-negative':''}`} style={{left:`${lo}%`,width:`${width}%`}}/></span><strong>{r.kind==='change'&&r.value>0?'+':''}{formatValue(r.value)}</strong></button>})}</div><div className="nf-inspect" role="status">{active||`${figure.endLabel} = ${figure.start.label} + ${figure.changes.length} changes. End total calculated from the supplied values.`}</div><small className="nf-baseline">{figure.unit} / shared scale including zero. Floating bars are changes, solid totals start at zero.</small></>
}

function Heatmap({figure}) {
  const values=figure.values.flat().filter(v=>v!==null),max=Math.max(...values.map(Math.abs))||1
  return <><div className="nf-table-scroll" tabIndex={0} role="region" aria-label={figure.title}><table className="nf-table nf-heatmap"><caption>{figure.unit} / {figure.period}</caption><thead><tr><th/>{figure.xLabels.map(x=><th scope="col" key={x}>{x}</th>)}</tr></thead><tbody>{figure.values.map((row,i)=><tr key={i}><th scope="row">{figure.yLabels[i]}</th>{row.map((v,j)=><td key={j} className={v===null?'nf-missing':''} style={v===null?{}:{background:`rgba(${v<0?'234,139,113':'105,179,221'},${.08+.5*Math.abs(v)/max})`}}>{v===null?'—':formatValue(v)}{v===null&&<span className="nf-sr-only">missing, not zero</span>}</td>)}</tr>)}</tbody></table></div><small className="nf-baseline">Stronger color means a larger absolute value. Blue: positive; coral: negative. — missing, not zero.</small></>
}

function Network({figure}) {
  const [selected,setSelected]=useState(null),arrowId=useId().replaceAll(':',''),count=figure.nodes.length
  const nodes=figure.nodes.map((n,i)=>({...n,x:320+220*Math.cos(-Math.PI/2+2*Math.PI*i/count),y:175+120*Math.sin(-Math.PI/2+2*Math.PI*i/count)}))
  const chosen=nodes.find(n=>n.id===selected)
  return <><svg className="nf-plot" viewBox="0 0 640 350" aria-label={figure.title}>
    <defs><marker id={arrowId} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7" fill="#777"/></marker></defs>
    {figure.edges.map((edge,i)=>{
      const a=nodes.find(n=>n.id===edge.from),b=nodes.find(n=>n.id===edge.to),active=selected===a.id||selected===b.id
      const reciprocal=figure.directed&&figure.edges.some(e=>e.from===edge.to&&e.to===edge.from)
      return <path key={i} d={networkEdgePath(a,b,reciprocal)} fill="none" stroke={active?'#88ccff':'#555'} strokeWidth={active?2:1} markerEnd={figure.directed?`url(#${arrowId})`:undefined}><title>{`${a.label} ${figure.directed?'→':'—'} ${b.label}: ${edge.label}`}</title></path>
    })}
    {nodes.map((n,i)=><g key={n.id}><Dot x={n.x} y={n.y} r={17} label={n.label} active={selected===n.id} onSelect={()=>setSelected(n.id)}/><text x={n.x} y={n.y+4} textAnchor="middle" fill="#fff" fontSize="12" pointerEvents="none">{i+1}</text></g>)}
  </svg><div className="nf-network-keys">{nodes.map((n,i)=><button type="button" key={n.id} aria-pressed={selected===n.id} onClick={()=>setSelected(n.id)}><span>{i+1}</span>{n.label}</button>)}</div><div className="nf-inspect" role="status">{chosen?`${chosen.label} / ${chosen.detail}`:'Select a node to inspect its role and connections.'}</div><ul className="nf-relations">{figure.edges.filter(e=>!selected||e.from===selected||e.to===selected).map((e,i)=><li key={i}>{nodes.find(n=>n.id===e.from).label} {figure.directed?'→':'—'} {nodes.find(n=>n.id===e.to).label}<span>{e.label}</span></li>)}</ul><small className="nf-baseline">Schematic relationships. Node position and distance are not measurements.</small></>
}

export default function NewsCharts({figure}) {
  switch(figure.kind) {
    case 'line':case 'scatter':return <Plot figure={figure}/>
    case 'stacked':return <Stacked figure={figure}/>
    case 'waterfall':return <Waterfall figure={figure}/>
    case 'heatmap':return <Heatmap figure={figure}/>
    case 'map':return <NewsFigureMap figure={figure}/>
    case 'network':return <Network figure={figure}/>
    case 'comparison':return <FigureTable figure={figure}/>
    default:return null
  }
}
