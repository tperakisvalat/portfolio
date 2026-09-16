import {after,before,test} from 'node:test'
import assert from 'node:assert/strict'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
import {visualExamples} from '../shared/news-visual-fixtures.js'

// Isolated component rendering only: no browser, listening server, live page,
// account, screenshots or layout claims. This catches JSX/runtime failures that
// the geometry/schema tests and Vite's build cannot catch.
let vite,NewsFigure
before(async()=>{
  vite=await createServer({configFile:false,envFile:false,plugins:[react()],optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,ws:false},appType:'custom'})
  NewsFigure=(await vite.ssrLoadModule('/src/components/NewsFigure.jsx')).default
})
after(async()=>{await vite?.close()})
test('every visual component renders with data and an accessible title',t=>{
  const warnings=[];t.mock.method(console,'error',(...args)=>warnings.push(args[0]))
  for(const figure of visualExamples){
    const markup=renderToStaticMarkup(createElement(NewsFigure,{figure}))
    assert(markup.includes('<figure'),figure.kind)
    assert(markup.includes('aria-labelledby='),figure.kind)
    assert(markup.includes(figure.title),figure.kind)
    assert(!markup.includes('NaN'),figure.kind)
    assert(!markup.includes('unavailable'),figure.kind)
    if(['line','scatter','network','map'].includes(figure.kind)){assert(markup.includes('<svg'));assert(markup.includes('role="button"'));assert(markup.includes('tabindex="0"'))}
  }
  assert.deepEqual(warnings,[],'React rendering warnings must be addressed')
})
test('unfinished admin JSON fails safely; public source links cannot inject markup',()=>{
  assert(renderToStaticMarkup(createElement(NewsFigure,{figure:{id:'unfinished',kind:'scatter'}})).includes('incomplete or unavailable'))
  const figure={...visualExamples[0],title:'<script>alert(1)</script>',sources:[{url:'javascript:alert(1)',itemId:'bad',title:'Bad'},{url:'https://example.org/paper',itemId:'ok',title:'<img src=x onerror=alert(1)>',publisher:'Fixture'}]}
  const markup=renderToStaticMarkup(createElement(NewsFigure,{figure}))
  assert(!markup.includes('<script>'));assert(!markup.includes('<img'));assert(!markup.includes('javascript:'))
  assert(markup.includes('https://example.org/paper'));assert(markup.includes('rel="noopener noreferrer"'))
})
