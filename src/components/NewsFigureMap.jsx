import { useMemo, useState } from 'react'
import DottedMap from 'dotted-map'
import { MAP_REGIONS, mapPosition } from '../../shared/news-visuals'

const maps=new Map()
function baseMap(region) {
  if(!maps.has(region)){
    const [west,south,east,north]=MAP_REGIONS[region]
    const map=new DottedMap({height:65,grid:'diagonal',region:{lat:{min:south,max:north},lng:{min:west,max:east}}})
    // Basemap dots have only grid x/y; geographic lat/lng exist on pins only.
    const nw=mapPosition(west,north,region),se=mapPosition(east,south,region)
    maps.set(region,map.getPoints().map(p=>{const x=nw.x+p.x/map.image.width*(se.x-nw.x),y=nw.y+p.y/map.image.height*(se.y-nw.y);return `M${x.toFixed(2)},${y.toFixed(2)}h.1`}).join(' '))
  }
  return maps.get(region)
}
export default function NewsFigureMap({figure}) {
  const [active,setActive]=useState(null),path=useMemo(()=>baseMap(figure.region),[figure.region]),chosen=figure.points.find(p=>p.label===active)
  return <><svg viewBox="0 0 640 340" className="nf-plot nf-map" aria-label={figure.title}>
    <path d={path} stroke="#30393f" strokeWidth="2.3" strokeLinecap="round" fill="none"/>
    {figure.points.map((point,i)=>{
      const {x,y}=mapPosition(point.lng,point.lat,figure.region)
      return <g key={point.label} tabIndex={0} role="button" aria-label={point.label} aria-pressed={active===point.label} onFocus={()=>setActive(point.label)} onMouseEnter={()=>setActive(point.label)} onClick={()=>setActive(point.label)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setActive(point.label)}}} className="nf-point">
        <title>{`${point.label}: ${point.detail}`}</title><circle cx={x} cy={y} r="17" fill="transparent"/><circle cx={x} cy={y} r={active===point.label?8:5} fill="#88ccff" stroke="#fff"/><text x={x+11} y={y-8} fill="#fff" fontSize="12">{i+1}</text>
      </g>
    })}
  </svg><div className="nf-network-keys">{figure.points.map((p,i)=><button type="button" key={p.label} aria-pressed={active===p.label} onClick={()=>setActive(p.label)}><span>{i+1}</span>{p.label}</button>)}</div><div className="nf-inspect" role="status">{chosen?`${chosen.label} / ${chosen.detail}`:'Select a location to read its annotation.'}</div><small className="nf-baseline">Mercator locator map / approximate coastlines. Equal-size markers identify places, not magnitude or territorial claims.</small></>
}
