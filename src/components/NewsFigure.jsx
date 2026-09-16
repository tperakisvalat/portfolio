import { useId } from 'react'
import { barLayout } from '../../shared/news-visuals'
import { FigureContent } from '../../shared/news-figure-schema'
import NewsCharts, { FigureTable } from './NewsCharts'
import './NewsFigure.css'

export default function NewsFigure({ figure }) {
  const titleId = useId(), captionId = useId()
  // The admin previews JSON while it is being edited; unfinished figures should
  // not take down the rest of the inbox. Saved figures are validated server-side.
  if(!figure||typeof figure!=='object')return null
  const {citations: _privateCitations,sources=[],...visual}=figure
  const parsed=FigureContent.safeParse(visual)
  if(!parsed.success)return <p className="nf-invalid" role="status">Figure incomplete or unavailable.</p>
  figure=parsed.data
  const safeSources=Array.isArray(sources)?sources.filter(s=>{try{const u=new URL(s.url);return u.protocol==='https:'&&!u.username&&!u.password}catch{return false}}):[]
  const layout = figure.kind === 'bars' ? barLayout(figure.rows.map(r => r.value)) : null
  return <figure className={`news-figure news-figure--${figure.kind}`} aria-labelledby={titleId} aria-describedby={captionId}>
    <header><h5 id={titleId}>{figure.title}</h5>{(figure.period||figure.unit)&&<span>{[figure.period,figure.unit].filter(Boolean).join(' · ')}</span>}</header>
    {layout ? <div className="nf-bars">
      {figure.rows.map((row, index) => <div className="nf-row" key={index}>
        <div className="nf-row-label"><span>{row.label}</span><strong>{new Intl.NumberFormat('en', {maximumSignificantDigits:8}).format(row.value)}</strong></div>
        <div className="nf-track" aria-hidden="true"><i className="nf-zero" style={{left:`${layout.zero}%`}}/><i className={row.value < 0 ? 'nf-bar nf-bar--negative' : 'nf-bar'} style={{left:`${layout.rows[index].left}%`,width:`${layout.rows[index].width}%`}}/></div>
        {row.note && <small>{row.note}</small>}
      </div>)}
      <span className="nf-baseline">shared scale · zero baseline</span>
    </div> : ['flow','timeline'].includes(figure.kind) ? <ol className="nf-steps">{figure.steps.map((step,index) => <li key={index}><span className="nf-step-marker" aria-hidden="true">{String(index+1).padStart(2,'0')}</span><div><strong>{step.label}</strong><p>{step.detail}</p></div></li>)}</ol> : <NewsCharts key={`${figure.id}:${figure.kind}`} figure={figure}/>}
    <figcaption id={captionId}>{figure.caption}</figcaption>
    {!['flow','timeline','comparison'].includes(figure.kind)&&<details className="nf-data"><summary>data +</summary><FigureTable figure={figure}/></details>}
    {!!safeSources.length && <details className="nf-sources"><summary>sources ↗</summary>{safeSources.map(source => <a key={source.itemId} href={source.url} target="_blank" rel="noopener noreferrer">{source.publisher} / {source.title}</a>)}</details>}
  </figure>
}
