import { supabase } from './supabase'
export { useNewsQuery } from './newsPublic'

export async function newsApi(path, { method = 'GET', body, token, idempotencyKey, signal } = {}) {
  const accessToken = token || (supabase ? (await supabase.auth.getSession()).data.session?.access_token : null)
  const response = await fetch(`/api/news/v1${path}`, {
    method, signal, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const data = await response.json().catch(() => ({ error: 'News service is not connected' }))
  if (!response.ok || data.error) throw new Error(`${data.error || `Request failed (${response.status})`}${data.requestId ? ` / request ${data.requestId}` : ''}`)
  return data
}
