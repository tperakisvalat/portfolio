import { useEffect, useLayoutEffect, useRef } from 'react'
import { flushSync } from 'react-dom'

// One switch restores instantaneous navigation without touching theme hovers.
const PAGE_TRANSITIONS_ENABLED = false
const TIMING = { duration: 200, easing: 'cubic-bezier(.22,.8,.2,1)' }

function aperture(element, reader) {
  const box = element?.getBoundingClientRect()
  const frame = reader.getBoundingClientRect()
  const width = frame.width || window.innerWidth
  const height = frame.height || window.innerHeight
  const clamp = (value, max) => Math.min(max, Math.max(0, value))
  if (!box || box.bottom <= frame.top || box.top >= frame.top + height) {
    return 'inset(45% 40% 45% 40%)'
  }
  // Pins get a small aperture; tiles keep their own rectangular footprint.
  const x = clamp(box.left - frame.left + box.width / 2, width)
  const y = clamp(box.top - frame.top + box.height / 2, height)
  const halfWidth = Math.max(18, box.width / 2)
  const halfHeight = Math.max(18, box.height / 2)
  return `inset(${clamp(y - halfHeight, height)}px ${clamp(width - x - halfWidth, width)}px ${clamp(height - y - halfHeight, height)}px ${clamp(x - halfWidth, width)}px)`
}

// Native snapshots keep the outgoing page intact without cloning interactive DOM.
// Motion is an enhancement: routing and scroll restoration never depend on it.
// https://developer.mozilla.org/en-US/docs/Web/API/ViewTransition
export default function useNewsTransition({ readerRef, viewRef, viewKey, reducedMotion }) {
  const activeRef = useRef(null)
  const fallbackRef = useRef(null)
  const commitRef = useRef(null)

  useLayoutEffect(() => {
    // Router updates may be scheduled in React transitions even inside flushSync.
    // Resolve only after the new route has actually committed its DOM.
    const active = activeRef.current
    if (active && active.targetKey !== viewKey) active.cancel()
    commitRef.current?.()
    commitRef.current = null
  }, [viewKey])

  useEffect(() => () => {
    activeRef.current?.cancel()
    fallbackRef.current?.cancel()
    commitRef.current?.()
  }, [])

  useEffect(() => {
    if (!reducedMotion) return
    activeRef.current?.cancel()
    fallbackRef.current?.cancel()
  }, [reducedMotion])

  return ({ update, source, targetKey, direction = 'in', returnTo }) => {
    activeRef.current?.cancel()
    fallbackRef.current?.cancel()
    const reader = readerRef.current
    const root = document.documentElement

    if (!PAGE_TRANSITIONS_ENABLED || reducedMotion || !document.startViewTransition) {
      commitRef.current = () => {
        if (direction === 'out' && returnTo) {
          reader.querySelector(`[data-news-node="${returnTo}"]`)?.focus({ preventScroll: true })
        }
        if (PAGE_TRANSITIONS_ENABLED && !reducedMotion && viewRef.current?.animate) {
          fallbackRef.current = viewRef.current?.animate([
            { opacity: 0 },
            { opacity: 1 },
          ], TIMING)
        }
      }
      flushSync(update)
      return
    }

    const work = {
      cancelled: false,
      committed: false,
      transition: null,
      targetKey,
      resolveCommit: null,
      cleanup() {
        if (activeRef.current !== work) return
        delete root.dataset.newsMotion
        root.style.removeProperty('--news-aperture')
        activeRef.current = null
      },
      cancel() {
        work.cancelled = true
        work.transition?.skipTransition()
        work.resolveCommit?.()
        work.cleanup()
      },
    }
    activeRef.current = work
    root.dataset.newsMotion = direction
    if (direction === 'in') root.style.setProperty('--news-aperture', aperture(source, reader))

    try {
      work.transition = document.startViewTransition(async () => {
        if (work.cancelled) return
        work.committed = true
        await new Promise(resolve => {
          const committed = () => {
            if (commitRef.current === committed) commitRef.current = null
            resolve()
          }
          work.resolveCommit = committed
          commitRef.current = committed
          flushSync(update)
        })
        if (work.cancelled) return
        const target = direction === 'out' && returnTo
          ? reader.querySelector(`[data-news-node="${returnTo}"]`)
          : viewRef.current
        if (direction === 'out') target?.focus({ preventScroll: true })
      })
      // ready rejects when a transition is skipped (e.g. a fast second click).
      work.transition.ready.catch(() => {})
      work.transition.updateCallbackDone.catch(() => {})
      work.transition.finished.then(() => work.cleanup(), () => work.cleanup())
    } catch {
      work.cancel()
      if (!work.committed) flushSync(update)
    }
  }
}
