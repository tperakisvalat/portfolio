import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import useReducedMotion from '../lib/useReducedMotion'

function LinkedText({ text }) {
  return (text || '').split(/(\[[^\]]+\]\([^)]+\))/g).map((part, index) => {
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/)
    return link ? <a key={index} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a> : part
  })
}

export default function PinPage({ pin, onClose }) {
  const reducedMotion = useReducedMotion()
  const scrollerRef = useRef(null)
  const backRef = useRef(null)
  const audioRef = useRef(null)
  const [progress, setProgress] = useState(0)
  const [active, setActive] = useState('intro')
  const [playing, setPlaying] = useState(false)
  const [audioError, setAudioError] = useState(false)
  const sections = [
    { key: 'intro', label: 'intro', exists: true },
    { key: 'writing', label: 'writing', exists: pin.writing?.length },
    { key: 'questions', label: 'questions', exists: pin.questions?.length },
    { key: 'read', label: 'read', exists: pin.read?.length },
    { key: 'to-read', label: 'to read', exists: pin.toRead?.length },
  ].filter(section => section.exists)

  useEffect(() => {
    const audio = audioRef.current
    if (audio) audio.play().catch(() => setPlaying(false))
    return () => audio?.pause()
  }, [pin.music?.url])

  useEffect(() => {
    const previousFocus = document.activeElement
    backRef.current?.focus({ preventScroll: true })
    const onKey = event => {
      if (event.key === 'Escape') onClose()
      if (event.key !== 'Tab') return
      const focusable = [...scrollerRef.current.querySelectorAll('a[href], button:not(:disabled)')]
      const first = focusable[0]
      const last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previousFocus?.focus({ preventScroll: true })
    }
  }, [onClose])

  const onScroll = () => {
    const node = scrollerRef.current
    const extent = node.scrollHeight - node.clientHeight
    setProgress(extent > 0 ? Math.round(node.scrollTop / extent * 100) : 100)
    const top = node.getBoundingClientRect().top + 150
    const passed = [...node.querySelectorAll('[data-pin-section]')].filter(section => section.getBoundingClientRect().top <= top)
    setActive(passed.at(-1)?.dataset.pinSection || 'intro')
  }

  const jumpTo = key => document.getElementById(`pin-${key}`)?.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' })

  const toggleMusic = async () => {
    if (!audioRef.current) return
    if (playing) audioRef.current.pause()
    else {
      try { await audioRef.current.play(); setAudioError(false) }
      catch { setAudioError(true) }
    }
  }

  return createPortal(
    <div className="pin-page" role="dialog" aria-modal="true" aria-labelledby="pin-page-title">
      <div className="pin-page-scroller" ref={scrollerRef} onScroll={onScroll}>
        <header className="pin-page-toolbar">
          <div className="pin-page-toolbar-main">
            <button type="button" ref={backRef} onClick={onClose} className="pin-page-back"><span>←</span> map</button>
            <span className="pin-page-location">{pin.name}<span className="pin-page-escape"> / esc</span></span>
            <button type="button" className="pin-page-top" onClick={() => jumpTo('intro')} aria-label="Back to top">{progress}% ↑</button>
          </div>
          <nav aria-label="On this page">
            {sections.map(section => <button type="button" key={section.key} aria-current={active === section.key ? 'location' : undefined} onClick={() => jumpTo(section.key)}>{section.label}</button>)}
          </nav>
          <div className="pin-page-progress" aria-hidden="true" style={{ transform: `scaleX(${progress / 100})` }} />
        </header>

        <div className="pin-page-content">
          <section className="pin-section" id="pin-intro" data-pin-section="intro">
            <p className="pin-page-coordinates">{Math.abs(pin.lat).toFixed(2)}° {pin.lat >= 0 ? 'N' : 'S'} &nbsp; {Math.abs(pin.lng).toFixed(2)}° {pin.lng >= 0 ? 'E' : 'W'}</p>
            <h1 className="pin-modal-title" id="pin-page-title">{pin.title}</h1>
            <p className="pin-intro"><LinkedText text={pin.intro} /></p>
          </section>
          {pin.writing?.length > 0 && <section className="pin-section" id="pin-writing" data-pin-section="writing">
            <h2 className="pin-section-title"><span>01</span> writing & projects</h2>
            <ul className="pin-list">{pin.writing.map((item, i) => <li key={i}><a href={item.url} target="_blank" rel="noreferrer">{item.title}</a></li>)}</ul>
          </section>}
          {pin.questions?.length > 0 && <section className="pin-section" id="pin-questions" data-pin-section="questions">
            <h2 className="pin-section-title"><span>02</span> questions i have</h2>
            <ul className="pin-list questions">{pin.questions.map((item, i) => <li key={i}>{item}</li>)}</ul>
          </section>}
          {[{ key: 'read', number: '03', label: "things i've read", items: pin.read }, { key: 'to-read', number: '04', label: 'things i want to read', items: pin.toRead }].map(section => section.items?.length > 0 && (
            <section className="pin-section" id={`pin-${section.key}`} data-pin-section={section.key} key={section.key}>
              <h2 className="pin-section-title"><span>{section.number}</span> {section.label}</h2>
              <ul className="pin-list">{section.items.map((item, i) => <li key={i}>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a> : <em>{item.title}</em>}{item.author && <span className="pin-book-author"> — {item.author}</span>}</li>)}</ul>
            </section>
          ))}
          <button type="button" className="pin-page-return" onClick={onClose}>← map</button>
        </div>

        {pin.music?.title && <div className={`pin-page-music ${playing ? 'is-playing' : ''}`}>
          {pin.music.url && <audio ref={audioRef} src={pin.music.url} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => { setPlaying(false); setAudioError(true) }} />}
          <button type="button" onClick={toggleMusic} disabled={!pin.music.url} aria-label={playing ? 'Pause music' : 'Play music'} aria-pressed={playing}>{playing ? 'Ⅱ' : '▶'}</button>
          <div><span>{pin.music.title}</span><small>{audioError ? 'audio unavailable' : pin.music.artist}</small></div>
          <span className="music-wave" aria-hidden="true"><i /><i /><i /><i /></span>
        </div>}
      </div>
    </div>, document.body,
  )
}
