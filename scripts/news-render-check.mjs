// Read a draft/public content JSON from stdin and exercise its actual React prose
// and figures in isolation. No browser, live-page fetch or pixel/layout assertion.
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
import {FigureContent} from '../shared/news-figure-schema.ts'

let input='',vite
try{
  for await(const chunk of process.stdin){input+=chunk;if(input.length>2_000_000)throw new Error('Render-check input exceeds limit')}
  const parsed=JSON.parse(input),content=parsed.content||parsed
  if(!Array.isArray(content.stories)||!content.stories.length)throw new Error('Expected edition content with stories')
  vite=await createServer({configFile:false,envFile:false,plugins:[react()],optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,ws:false},appType:'custom'})
  const NewsProse=(await vite.ssrLoadModule('/src/components/NewsProse.jsx')).default,kinds={},warnings=[],oldError=console.error
  console.error=(...args)=>warnings.push(String(args[0]))
  try{
    for(const story of content.stories){
      for(const {citations,sources,...figure} of story.visuals||[]){FigureContent.parse(figure);kinds[figure.kind]=(kinds[figure.kind]||0)+1}
      const markup=renderToStaticMarkup(createElement(NewsProse,{body:story.body,visuals:story.visuals||[]}))
      if((markup.match(/<figure\b/g)||[]).length!==(story.visuals||[]).length)throw new Error(`Figure insertion failed: ${story.id}`)
      if(/(?:cx|cy|d|style)="[^"]*NaN/.test(markup)||markup.includes('Figure incomplete or unavailable.'))throw new Error(`Figure geometry failed: ${story.id}`)
    }
  }finally{console.error=oldError}
  if(warnings.length)throw new Error(`${warnings.length} React render warnings`)
  console.log(JSON.stringify({result:'isolated reader-component check passed',date:content.date,stories:content.stories.length,headlines:content.headlines?.length||0,figures:kinds,browserVerified:false}))
}catch(error){console.error(error.message);process.exitCode=1}
finally{await vite?.close()}
