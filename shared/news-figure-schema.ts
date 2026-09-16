import { z } from 'zod'
import { MAP_REGIONS } from './news-visuals.js'

const number = z.number().min(-1e12).max(1e12)
const label = z.string().min(1).max(100)
const note = z.string().max(240)
const unit = z.string().min(1).max(80)
const period = z.string().min(3).max(150)
const id = z.string().regex(/^[a-z0-9-]{1,80}$/)
const point = z.object({ x:z.number().min(-1e12).max(4102444800000), y:number.nullable() }).strict()

// Same visual contract on the client and server. Only the server version adds
// mandatory evidence; the public projection never needs private citation data.
export function figureSchema<T extends z.ZodRawShape>(extra:T) {
  const base = { id, afterParagraph:z.number().int().min(1).max(24), title:z.string().min(5).max(160), caption:z.string().min(15).max(900), ...extra }
  return z.discriminatedUnion('kind', [
    z.object({ ...base, kind:z.literal('bars'), unit, period, rows:z.array(z.object({label,value:number,note}).strict()).min(2).max(8) }).strict(),
    z.object({ ...base, kind:z.enum(['flow','timeline']), steps:z.array(z.object({label,detail:z.string().min(3).max(350)}).strict()).min(2).max(6) }).strict(),
    z.object({ ...base, kind:z.literal('line'), xLabel:label, yLabel:label, xUnit:unit, yUnit:unit, xFormat:z.enum(['number','date']), yBaseline:z.enum(['zero','extent']),
      series:z.array(z.object({label,points:z.array(point).min(2).max(60)}).strict()).min(1).max(4),
      annotations:z.array(z.object({series:label,pointIndex:z.number().int().min(0).max(59),text:z.string().min(3).max(180)}).strict()).max(4).optional(),
    }).strict(),
    z.object({ ...base, kind:z.literal('scatter'), xLabel:label,yLabel:label,xUnit:unit,yUnit:unit,period,
      sizeUnit:unit.optional(), points:z.array(z.object({label,x:number,y:number,size:z.number().positive().max(1e12).optional(),group:label.optional()}).strict()).min(2).max(60),
    }).strict(),
    z.object({ ...base, kind:z.literal('stacked'), unit,period,mode:z.enum(['absolute','share']),segments:z.array(label).min(2).max(5),
      rows:z.array(z.object({label,values:z.array(z.number().min(0).max(1e12)).min(2).max(5),note}).strict()).min(2).max(8),
    }).strict(),
    z.object({ ...base, kind:z.literal('waterfall'),unit,period,start:z.object({label,value:number}).strict(),endLabel:label,
      changes:z.array(z.object({label,value:number}).strict()).min(1).max(8),
    }).strict(),
    z.object({ ...base, kind:z.literal('heatmap'),unit,period,xLabels:z.array(label).min(2).max(8),yLabels:z.array(label).min(2).max(8),
      values:z.array(z.array(number.nullable()).min(2).max(8)).min(2).max(8),
    }).strict(),
    z.object({ ...base, kind:z.literal('map'),region:z.enum(['world','europe','asia','middle-east','africa','americas']),
      points:z.array(z.object({label,lat:z.number().min(-80).max(80),lng:z.number().min(-180).max(180),detail:z.string().min(3).max(350)}).strict()).min(1).max(12),
    }).strict(),
    z.object({ ...base, kind:z.literal('network'),directed:z.boolean(),
      nodes:z.array(z.object({id,label:label.max(55),detail:z.string().min(3).max(350)}).strict()).min(2).max(8),
      edges:z.array(z.object({from:id,to:id,label:z.string().min(1).max(160)}).strict()).min(1).max(16),
    }).strict(),
    z.object({ ...base, kind:z.literal('comparison'),columns:z.array(label).min(2).max(4),
      rows:z.array(z.object({label,values:z.array(z.string().min(1).max(240)).min(2).max(4)}).strict()).min(2).max(8),
    }).strict(),
  ]).superRefine((figure:any,ctx) => {
    const error=(message:string)=>ctx.addIssue({code:'custom',message})
    const unique=(values:string[],name:string)=>{if(new Set(values).size!==values.length)error(`${name} must be unique`)}
    if(figure.kind==='line') {
      unique(figure.series.map((s:any)=>s.label),'Series labels')
      for(const s of figure.series) {
        if(s.points.filter((p:any)=>p.y!==null).length<2)error('Each line needs two observed values; null marks missing observations')
        if(s.points.some((p:any,i:number)=>i>0&&p.x<=s.points[i-1].x))error('Line x coordinates must be strictly increasing; date x values use Unix milliseconds')
        if(figure.xFormat==='date'&&s.points.some((p:any)=>p.x<0||p.x>4102444800000))error('Date coordinates must be Unix milliseconds between 1970 and 2100')
      }
      for(const a of figure.annotations||[])if(figure.series.find((s:any)=>s.label===a.series)?.points[a.pointIndex]?.y==null)error('Annotation must reference an observed point in an existing series')
    }
    if(figure.kind==='scatter') {
      unique(figure.points.map((p:any)=>p.label),'Point labels')
      if(figure.sizeUnit&&!figure.points.every((p:any)=>p.size!=null)||!figure.sizeUnit&&figure.points.some((p:any)=>p.size!=null))error('Bubble plots require a size for every point and sizeUnit; ordinary scatter plots omit both')
      if(new Set(figure.points.map((p:any)=>p.group||'')).size>5)error('Use no more than five scatter groups')
    }
    if(figure.kind==='stacked') {
      unique(figure.segments,'Segment labels')
      unique(figure.rows.map((r:any)=>r.label),'Row labels')
      if(figure.rows.some((r:any)=>r.values.length!==figure.segments.length))error('Every stacked row must have one value per segment')
    }
    if(figure.kind==='heatmap') {
      unique(figure.xLabels,'Column labels');unique(figure.yLabels,'Row labels')
      if(figure.values.length!==figure.yLabels.length||figure.values.some((r:any[])=>r.length!==figure.xLabels.length))error('Heatmap dimensions must match its labels')
      if(!figure.values.flat().some((v:any)=>v!==null))error('Heatmap needs at least one observed value')
    }
    if(figure.kind==='network') {
      unique(figure.nodes.map((n:any)=>n.id),'Node IDs')
      const ids=new Set(figure.nodes.map((n:any)=>n.id))
      if(figure.edges.some((e:any)=>!ids.has(e.from)||!ids.has(e.to)||e.from===e.to))error('Edges must join two distinct existing nodes')
      unique(figure.edges.map((e:any)=>figure.directed?`${e.from}/${e.to}`:[e.from,e.to].sort().join('/')),'Edges')
    }
    if(figure.kind==='map'){
      unique(figure.points.map((p:any)=>p.label),'Map labels')
      const [west,south,east,north]=MAP_REGIONS[figure.region]
      if(figure.points.some((p:any)=>p.lng<west||p.lng>east||p.lat<south||p.lat>north))error('Map points must lie within the selected region; use world for wider coverage')
    }
    if(figure.kind==='comparison') {
      unique(figure.columns,'Column labels')
      if(figure.rows.some((r:any)=>r.values.length!==figure.columns.length))error('Comparison rows must match the column count')
    }
  })
}

export const FigureContent = figureSchema({})
export type FigureData = z.infer<typeof FigureContent>
