import { useEffect, useState } from 'react'

export const NEWS_PUBLICATION_KEY = 'tpv.news.publication.v1'
const publicationEvent = 'tpv:news-published'

export async function readPublicNews(path, { signal } = {}) {
  const response = await fetch(`/api/news/v1${path}`, { signal, cache: 'no-store', credentials: 'omit' })
  if (!response.ok) throw new Error('Reading room temporarily unavailable')
  const data = await response.json()
  if (data.error) throw new Error('Reading room temporarily unavailable')
  return data
}

export function announcePublication(editionId) {
  window.dispatchEvent(new Event(publicationEvent))
  // Only a public edition ID crosses tabs. Storage may be unavailable; focus
  // revalidation and the brief's polling still work in that case.
  try { window.localStorage.setItem(NEWS_PUBLICATION_KEY, JSON.stringify({ editionId, at: Date.now() })) } catch { /* Optional cross-tab signal. */ }
}

export function useNewsQuery(path, { refreshInterval = 0 } = {}) {
  const [state, setState] = useState({ data: null, loading: true, error: null })
  useEffect(() => {
    let active = true, controller
    setState({ data: null, loading: true, error: null })
    const refresh = async () => {
      controller?.abort()
      const request = new AbortController()
      controller = request
      try {
        const data = await readPublicNews(path, { signal: request.signal })
        if (!active || request.signal.aborted || controller !== request) return
        setState(previous => {
          // Published editions are immutable. Don't rerender an unchanged brief.
          if (path === '/brief/latest' && previous.data?.edition?.id === data.edition?.id && previous.data && !previous.error) return previous
          return { data, loading: false, error: null }
        })
      } catch (error) {
        if (!active || request.signal.aborted || controller !== request) return
        setState(previous => ({ ...previous, loading: false, error: error.message }))
      }
    }
    const whenVisible = () => { if (!document.hidden) void refresh() }
    const onStorage = event => { if (event.key === NEWS_PUBLICATION_KEY) whenVisible() }
    window.addEventListener(publicationEvent, whenVisible)
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', whenVisible)
    window.addEventListener('online', whenVisible)
    document.addEventListener('visibilitychange', whenVisible)
    const timer = refreshInterval > 0 ? window.setInterval(whenVisible, refreshInterval) : null
    void refresh()
    return () => {
      active = false; controller?.abort()
      if (timer !== null) window.clearInterval(timer)
      window.removeEventListener(publicationEvent, whenVisible)
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', whenVisible)
      window.removeEventListener('online', whenVisible)
      document.removeEventListener('visibilitychange', whenVisible)
    }
  }, [path, refreshInterval])
  return state
}
