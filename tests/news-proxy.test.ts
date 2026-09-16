import { test } from 'node:test'
import assert from 'node:assert/strict'
import { proxyNews } from '../api/news-proxy.js'
test('Vercel proxy preserves scope/auth/version keys and never forwards cookies or follows redirects',async()=>{
  const prior=process.env.NEWS_BACKEND_URL;process.env.NEWS_BACKEND_URL='https://news.example.org'
  try {
    const request=new Request('https://tpv.world/api/news-proxy?newsPath=v1/admin/drafts/123/publish',{method:'POST',headers:{authorization:'Bearer scoped',cookie:'personal=private','idempotency-key':'version-key',origin:'https://tpv.world','content-type':'application/json'},body:'{"expectedVersion":1}'})
    const result=await proxyNews(request,async(url:any,opts:any)=>{assert.equal(String(url),'https://news.example.org/api/news/v1/admin/drafts/123/publish');assert.equal(opts.headers.get('authorization'),'Bearer scoped');assert.equal(opts.headers.get('cookie'),null);assert.equal(opts.headers.get('idempotency-key'),'version-key');assert.equal(opts.redirect,'manual');return Response.json({ok:true})})
    assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store')
    assert.equal((await proxyNews(new Request('https://tpv.world/api/news-proxy?newsPath=../../secrets'))).status,404)
    const brief=await proxyNews(new Request('https://tpv.world/news/brief.txt?newsPath=brief.txt'),async(url:any)=>{assert.equal(String(url),'https://news.example.org/news/brief.txt');return new Response('same edition',{headers:{'content-type':'text/plain'}})})
    assert.equal(await brief.text(),'same edition')
    delete process.env.NEWS_BACKEND_URL;assert.equal((await proxyNews(request)).status,503)
  }finally{if(prior===undefined)delete process.env.NEWS_BACKEND_URL;else process.env.NEWS_BACKEND_URL=prior}
})
