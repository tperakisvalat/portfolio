import https from 'node:https'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

let arxivQueue=Promise.resolve(),arxivLastRequest=0
export async function safeFetch(input:string,allowedHosts:string[],redirects=0):Promise<string> {
  const host=new URL(input).hostname
  if(host!=='arxiv.org'&&!host.endsWith('.arxiv.org'))return fetchSource(input,allowedHosts,redirects)
  const previous=arxivQueue
  let release!:()=>void
  arxivQueue=new Promise(resolve=>{release=resolve})
  await previous
  try{const delay=arxivLastRequest+3100-Date.now();if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));arxivLastRequest=Date.now();return await fetchSource(input,allowedHosts,redirects)}finally{release()}
}

// Resolve once, validate every answer, then pin the HTTPS connection to that answer.
// No cookies, arbitrary headers, redirects to new hosts, or proxy environment inheritance.
export function publicAddress(ip: string) {
  if (isIP(ip) === 4) {
    const [a,b] = ip.split('.').map(Number)
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0,168].includes(b)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18,19,51].includes(b)) || (a === 203 && b === 0))
  }
  // Conservative IPv6 policy: global unicast only; exclude mapped/private/transition forms.
  const lower = ip.toLowerCase()
  return isIP(ip) === 6 && /^[23]/.test(lower) && !lower.startsWith('2001:db8:') && !lower.startsWith('2001:0:') && !lower.startsWith('2002:')
}
async function fetchSource(input: string, allowedHosts: string[], redirects = 0): Promise<string> {
  const url = new URL(input)
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !allowedHosts.includes(url.hostname) || isIP(url.hostname) || redirects > 3) throw new Error('URL rejected by source network policy')
  const addresses = await lookup(url.hostname, { all: true })
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error('Non-public source address rejected')
  const resolved = addresses.find(a => a.family === 4) || addresses[0]
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      agent: false, headers: { 'User-Agent': 'tpv.world research reader/0.1', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json' },
      lookup: (_host, options, cb) => {
        // Node's automatic family selection asks for all addresses; keep that
        // signature while still pinning to the one validated address.
        if ((options as any).all) (cb as any)(null, [resolved])
        else cb(null, resolved.address, resolved.family)
      },
    }, response => {
      const status = response.statusCode || 0
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume()
        fetchSource(new URL(response.headers.location, url).href, allowedHosts, redirects + 1).then(resolve, reject)
        return
      }
      if (status !== 200) { response.resume(); reject(new Error(`Source HTTP ${status}`)); return }
      const chunks: Buffer[] = []; let size = 0
      response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 3_000_000) request.destroy(new Error('Feed exceeds 3 MB')); else chunks.push(chunk) })
      response.on('end', () => { clearTimeout(deadline); resolve(Buffer.concat(chunks).toString('utf8')) })
      response.on('error', reject)
    })
    const deadline = setTimeout(() => request.destroy(new Error('Source timed out')), 15000)
    request.on('close', () => clearTimeout(deadline))
    request.on('error', reject)
  })
}
