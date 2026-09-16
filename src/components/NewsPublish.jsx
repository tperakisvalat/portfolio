import { useId, useRef, useState } from 'react'
import { announcePublication, readPublicNews } from '../lib/newsPublic'

// Key this component by draft ID + version. A retry must reuse the same key:
// a lost response is not proof that the server didn't commit publication.
export default function NewsPublish({ draft, dirty, api, onPublished, onBusyChange }) {
  const [phase, setPhase] = useState('idle')
  const [message, setMessage] = useState('')
  const [receipt, setReceipt] = useState(null)
  const requestKey = useRef(null)
  const inFlight = useRef(false)
  const confirmationId = useId()
  const unavailable = !draft || draft.status !== 'draft' || dirty

  const publish = async () => {
    if (unavailable || inFlight.current) return
    inFlight.current = true
    onBusyChange?.(true)
    setPhase('publishing'); setMessage('Publishing…')
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 30000)
    let edition
    try {
      requestKey.current ||= crypto.randomUUID()
      edition = await api(`/drafts/${draft.id}/publish`, {
        method: 'POST', body: { expectedVersion: draft.version },
        idempotencyKey: requestKey.current, signal: controller.signal,
      })
      if (!edition?.id) throw new Error('The server did not return a publication receipt.')
    } catch (error) {
      setPhase('error')
      setMessage(`Could not confirm publication: ${error.name === 'AbortError' ? 'the request timed out.' : error.message} You can retry safely.`)
      return
    } finally {
      window.clearTimeout(timeout)
      if (!edition?.id) { inFlight.current = false; onBusyChange?.(false) }
    }

    // A successful commit stays successful even if the subsequent read fails.
    setReceipt(edition); setPhase('checking'); setMessage('Published. Checking the public edition…')
    onPublished?.(edition)
    announcePublication(edition.id)
    const check = new AbortController()
    const checkTimeout = window.setTimeout(() => check.abort(), 15000)
    try {
      const current = await readPublicNews('/brief/latest', { signal: check.signal })
      setMessage(current.edition?.id === edition.id
        ? 'Published. This edition is live.'
        : 'Published, but another edition is currently public. Refresh the desk to check the latest publication.')
    } catch {
      setMessage('Published successfully. The public-page check failed; open the brief to check it. Do not publish again.')
    } finally {
      window.clearTimeout(checkTimeout)
      setPhase('done'); inFlight.current = false; onBusyChange?.(false)
    }
  }

  return <div className="na-publish" aria-label="Publication">
    {receipt || draft?.status === 'published' ? <>
      <p role="status">{message || 'This version is published.'}</p>
      <a href="/news#daily-brief" target="_blank" rel="noopener noreferrer">open public brief ↗</a>
    </> : <>
      <button type="button" aria-expanded={phase === 'confirm' || phase === 'error'} aria-controls={confirmationId} disabled={unavailable || phase === 'publishing'} onClick={() => { setPhase('confirm'); setMessage('') }}>publish v{draft?.version || '—'}</button>
      {dirty && <p>Save your changes before publishing.</p>}
      {(phase === 'confirm' || phase === 'error') && <div className="na-publish-confirm" id={confirmationId} role="group" aria-labelledby={`${confirmationId}-label`}>
        <p id={`${confirmationId}-label`}>Publish {draft?.content.date} / v{draft?.version}? This replaces the public daily brief.</p>
        {draft?.quality?.status === 'needs_revision' && <p>The editorial review still flags changes. Publication is your decision.</p>}
        <div className="na-actions">
          <button type="button" disabled={unavailable} onClick={publish}>{phase === 'error' ? 'retry publication' : 'confirm publish'}</button>
          <button type="button" onClick={() => { setPhase('idle'); setMessage('') }}>cancel</button>
        </div>
      </div>}
      {message && <p role={phase === 'error' ? 'alert' : 'status'}>{message}</p>}
    </>}
  </div>
}
