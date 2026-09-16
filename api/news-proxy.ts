// Short Vercel requests proxy the persistent editorial service. Never run the
// Codex editor itself inside this function, and never send OpenAI keys here.
export async function proxyNews(request:Request, upstreamFetch:typeof fetch=fetch) {
  try {
    if(!process.env.NEWS_BACKEND_URL)return Response.json({error:'News backend is not configured'},{status:503})
    const base=new URL(process.env.NEWS_BACKEND_URL)
    if(base.protocol!=='https:' || base.username || base.password || base.pathname!=='/')return Response.json({error:'Invalid backend configuration'},{status:503})
    const incoming=new URL(request.url),path=incoming.searchParams.get('newsPath')||''
    if(path!=='brief.txt'&&!/^v1\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/.test(path))return Response.json({error:'Unknown news endpoint'},{status:404})
    if(!['GET','HEAD','POST','PUT','DELETE'].includes(request.method))return new Response(null,{status:405})
    const target=new URL(path==='brief.txt'?'/news/brief.txt':`/api/news/${path}`,base)
    incoming.searchParams.delete('newsPath');target.search=incoming.searchParams.toString()
    const headers=new Headers()
    for(const name of ['authorization','content-type','idempotency-key','origin']){const value=request.headers.get(name);if(value)headers.set(name,value)}
    const body=['GET','HEAD'].includes(request.method)?undefined:await request.arrayBuffer()
    if(body&&body.byteLength>250000)return Response.json({error:'Request too large'},{status:413})
    const response=await upstreamFetch(target,{method:request.method,headers,body,redirect:'manual',signal:AbortSignal.timeout(25000)})
    if(response.status>=300&&response.status<400)return Response.json({error:'Unexpected backend redirect'},{status:502})
    return new Response(response.body,{status:response.status,headers:{'Content-Type':response.headers.get('content-type')||'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})
  }catch{return Response.json({error:'News backend is temporarily unavailable'},{status:502})}
}
export default {fetch:(request:Request)=>proxyNews(request)}
