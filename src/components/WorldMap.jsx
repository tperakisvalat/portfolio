import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import DottedMap from 'dotted-map'
import { fetchPins } from '../lib/supabase'
import PinPage from './PinPage'
import useReducedMotion from '../lib/useReducedMotion'

// Each gesture advances one complete scene. Explicit route stops remain available.
const ANIMATION_DURATION = 1700
const COUNTRY_DELAY = 0.3
const DOT_ANIMATION = 0.85
const TYPEWRITER_SPEED = 16
const ROUTE_STOPS = ['start', 'madrid', 'origins', 'grew up', 'today', 'map']
let lastSection = 0

const WORLD_REGION = {
  lat: { min: -60, max: 85 },
  lng: { min: -180, max: 180 }
}

// Story data
const STORY_SECTIONS = [
  { id: 'start', text: '', cityLabel: '', countries: [], pins: [], isSimple: true },
  { id: 'born', text: "born in 🇪🇸 madrid (but don't ask me to speak spanish)", cityLabel: 'Madrid, Spain', countries: ['ESP'], pins: ['Madrid'] },
  { id: 'origins', text: 'originally 🇫🇷 french & 🇬🇷 greek (so ik what good food is)', cityLabel: 'Paris, France  ·  Athens, Greece', countries: ['FRA', 'GRC'], pins: ['Paris', 'Athens'] },
  { id: 'grewup', text: 'grew up all over 🇩🇪🇫🇷🇨🇳 (and surprisingly chinese is the language that stuck)', cityLabel: 'Düsseldorf, Germany  ·  Shanghai, China', countries: ['DEU', 'CHN'], pins: ['Düsseldorf', 'Shanghai'] },
  { id: 'school', text: 'studied in philly (upenn), now working in new york (hebbia) 🇺🇸', cityLabel: 'Philadelphia  ·  New York City', countries: ['USA'], pins: ['Philadelphia', 'NYC'] },
  { id: 'explore', text: 'click dots :)', cityLabel: '', countries: ['ALL'], pins: ['ALL'], isSimple: true },
]

// Story pins (shown during scroll story)
const STORY_PINS = [
  { name: 'Madrid', lat: 40.4168, lng: -3.7038, category: 'past' },
  { name: 'Düsseldorf', lat: 51.2277, lng: 6.7735, category: 'past' },
  { name: 'Shanghai', lat: 31.2304, lng: 121.4737, category: 'past' },
  { name: 'Athens', lat: 37.9838, lng: 23.7275, category: 'past' },
  { name: 'Paris', lat: 48.8566, lng: 2.3522, category: 'past' },
  { name: 'Philadelphia', lat: 39.9526, lng: -75.1652, category: 'past' },
  { name: 'NYC', lat: 40.7128, lng: -74.0060, category: 'current' },
]

// Countries visited (will be light blue)
const VISITED_COUNTRIES = [
  'AUS', 'ZAF', 'MAR', 'ARE', 'OMN', 'EGY', 'JOR', 'ARG', 'BRA', 'GTM', 'MEX',
  'FRA', 'GBR', 'ESP', 'ITA', 'PRT', 'HUN', 'GRC', 'VNM', 'MMR', 'LKA',
  'JPN', 'KOR', 'SGP', 'UKR', 'ISL', 'DEU', 'CHN', 'USA'
]

const STORY_COUNTRIES = ['ESP', 'FRA', 'GRC', 'DEU', 'CHN', 'USA']

function StoryTerminal({ text, visible, reducedMotion }) {
  const [displayedText, setDisplayedText] = useState('')
  useEffect(() => {
    if (!visible || reducedMotion) return
    let index = 0
    const letters = Array.from(text)
    const timer = setInterval(() => {
      index += 1
      setDisplayedText(letters.slice(0, index).join(''))
      if (index >= letters.length) clearInterval(timer)
    }, TYPEWRITER_SPEED)
    return () => clearInterval(timer)
  }, [text, visible, reducedMotion])
  return <div className="terminal-box" style={{ visibility: visible ? 'visible' : 'hidden' }}>
    <span className="terminal-prompt">&gt;</span>
    <span className="terminal-text" aria-label={text}><span aria-hidden="true">{reducedMotion ? text : displayedText}<span className="terminal-cursor" /></span></span>
  </div>
}

function WorldMap() {
  const [currentSection, setCurrentSection] = useState(() => lastSection)
  const [animationPhase, setAnimationPhase] = useState('done')
  const [animationKey, setAnimationKey] = useState(0)
  const [selectedPin, setSelectedPin] = useState(null)
  const [explorePinsData, setExplorePinsData] = useState([])
  const [hoveredPin, setHoveredPin] = useState(null)
  const [pinsStatus, setPinsStatus] = useState('loading')
  const reducedMotion = useReducedMotion()
  const containerRef = useRef(null)
  const timerRef = useRef(null)
  const sectionRef = useRef(currentSection)
  const lockUntilRef = useRef(0)
  const closePin = useCallback(() => setSelectedPin(null), [])

  const goTo = useCallback(index => {
    const next = Math.max(0, Math.min(STORY_SECTIONS.length - 1, index))
    if (next === sectionRef.current) return
    sectionRef.current = next
    lastSection = next
    lockUntilRef.current = performance.now() + (reducedMotion || STORY_SECTIONS[next].isSimple ? 350 : ANIMATION_DURATION)
    setHoveredPin(null)
    setCurrentSection(next)
  }, [reducedMotion])

  // Fetch pins data from Supabase on mount and when window regains focus
  useEffect(() => {
    const loadPins = async () => {
      try {
        const pins = await fetchPins()
        if (pins) { setExplorePinsData(pins); setPinsStatus(pins.length ? 'ready' : 'empty') }
        else setPinsStatus('error')
      } catch (err) {
        setPinsStatus('error')
        console.error('Failed to fetch pins:', err)
      }
    }

    loadPins()

    const handleFocus = () => loadPins()
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [])

  // Generate map data (recomputes when explore pins change)
  const mapData = useMemo(() => {
    // Create world map with story pins
    const worldMap = new DottedMap({ height: 60, grid: 'diagonal', region: WORLD_REGION })
    STORY_PINS.forEach(pin => {
      worldMap.addPin({ lat: pin.lat, lng: pin.lng, data: pin, svgOptions: { radius: 0.5 } })
    })
    const worldPoints = worldMap.getPoints()

    // Build coordinate lookup for matching country points
    const coordMap = new Map()
    worldPoints.forEach((p, i) => coordMap.set(`${p.x.toFixed(2)},${p.y.toFixed(2)}`, i))

    // Find which points belong to each country (story + visited)
    const allCountries = [...new Set([...STORY_COUNTRIES, ...VISITED_COUNTRIES])]
    const countryIndices = {}
    allCountries.forEach(code => {
      countryIndices[code] = new Set()
      try {
        const countryMap = new DottedMap({ height: 60, grid: 'diagonal', countries: [code], region: WORLD_REGION })
        countryMap.getPoints().forEach(cp => {
          const idx = coordMap.get(`${cp.x.toFixed(2)},${cp.y.toFixed(2)}`)
          if (idx !== undefined) countryIndices[code].add(idx)
        })
      } catch (e) { /* Country not found */ }
    })

    // Tag points as dots or pins with country info
    const tagged = worldPoints.map((point, index) => {
      if (point.data?.name) {
        return { ...point, type: 'pin', name: point.data.name, category: point.data.category }
      }
      const storyCountry = STORY_COUNTRIES.find(code => countryIndices[code]?.has(index))
      const visitedCountry = VISITED_COUNTRIES.find(code => countryIndices[code]?.has(index))
      return { ...point, type: 'dot', country: storyCountry || 'REST', visited: !!visitedCountry }
    })

    // Separate and sort pins (current on top)
    const dots = tagged.filter(p => p.type === 'dot')
    const storyPins = tagged.filter(p => p.type === 'pin')
      .sort((a, b) => ({ past: 0, future: 1, current: 2 }[a.category] - { past: 0, future: 1, current: 2 }[b.category]))

    // Generate explore pins separately (need their own coordinates)
    const exploreMap = new DottedMap({ height: 60, grid: 'diagonal', region: WORLD_REGION })
    explorePinsData.forEach(pin => {
      exploreMap.addPin({ lat: pin.lat, lng: pin.lng, data: pin, svgOptions: { radius: 0.5 } })
    })
    const explorePins = exploreMap.getPoints()
      .filter(p => p.data?.name)
      .map(p => ({ ...p, ...p.data }))

    const xs = worldPoints.map(p => p.x)
    const ys = worldPoints.map(p => p.y)
    return { dots, storyPins, explorePins, width: Math.max(...xs) + 1, height: Math.max(...ys) + 1 }
  }, [explorePinsData])

  const story = STORY_SECTIONS[currentSection]
  const isExplore = currentSection === STORY_SECTIONS.length - 1
  const isStart = currentSection === 0

  useEffect(() => {
    clearTimeout(timerRef.current)
    setAnimationKey(key => key + 1)
    if (!story.isSimple && !reducedMotion) {
      lockUntilRef.current = performance.now() + ANIMATION_DURATION
      setAnimationPhase('animating')
      timerRef.current = setTimeout(() => setAnimationPhase('done'), ANIMATION_DURATION)
    } else {
      lockUntilRef.current = 0
      setAnimationPhase('done')
    }
    return () => {
      clearTimeout(timerRef.current)
    }
  }, [currentSection, story, reducedMotion])

  useEffect(() => {
    const container = containerRef.current
    if (!container || selectedPin) return
    let lastWheel = 0
    let total = 0
    let consumed = false
    let touchStart = null
    const step = direction => {
      if (performance.now() < lockUntilRef.current) return
      goTo(sectionRef.current + direction)
    }
    const onWheel = event => {
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
      event.preventDefault()
      const now = performance.now()
      if (now - lastWheel > 200) { total = 0; consumed = false }
      lastWheel = now
      if (consumed) return
      if (now < lockUntilRef.current) { consumed = true; return }
      total += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? container.clientHeight : 1)
      if (Math.abs(total) > 45) { step(Math.sign(total)); consumed = true }
    }
    const onTouchStart = event => { touchStart = event.touches.length === 1 ? event.touches[0].clientY : null }
    const onTouchEnd = event => {
      if (touchStart == null || !event.changedTouches.length) return
      const distance = touchStart - event.changedTouches[0].clientY
      if (Math.abs(distance) > 45) step(Math.sign(distance))
      touchStart = null
    }
    const onKey = event => {
      if (event.defaultPrevented || event.target.closest?.('button, a, input, textarea, select, [role="button"]') || event.repeat) return
      if (['ArrowDown', 'ArrowRight', 'PageDown', ' '].includes(event.key)) { event.preventDefault(); step(1) }
      if (['ArrowUp', 'ArrowLeft', 'PageUp'].includes(event.key)) { event.preventDefault(); step(-1) }
      if (event.key === 'End') { event.preventDefault(); goTo(STORY_SECTIONS.length - 1) }
      if (event.key === 'Home') { event.preventDefault(); goTo(0) }
    }
    container.addEventListener('wheel', onWheel, { passive: false })
    container.addEventListener('touchstart', onTouchStart, { passive: true })
    container.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('keydown', onKey)
    return () => {
      container.removeEventListener('wheel', onWheel)
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('keydown', onKey)
    }
  }, [goTo, selectedPin])

  // Compute past countries/pins (from previous sections)
  const past = useMemo(() => {
    const countries = new Set(), pins = new Set()
    for (let i = 0; i < currentSection; i++) {
      STORY_SECTIONS[i].countries.forEach(c => c !== 'ALL' && countries.add(c))
      STORY_SECTIONS[i].pins.forEach(p => p !== 'ALL' && pins.add(p))
    }
    return { countries, pins }
  }, [currentSection])

  // Current active countries/pins
  const isAll = story.countries.includes('ALL')
  const current = {
    countries: isAll ? new Set([...STORY_COUNTRIES, 'REST']) : new Set(story.countries),
    pins: isAll ? new Set(STORY_PINS.map(p => p.name)) : new Set(story.pins)
  }

  // State helpers
  const getDotState = (country) => current.countries.has(country) ? 'current' : past.countries.has(country) ? 'past' : 'base'
  const getPinState = (name) => current.pins.has(name) ? 'current' : past.pins.has(name) ? 'past' : 'hidden'

  // Animation delay helpers (memoized filtered arrays)
  const filteredCountries = useMemo(() => story.countries.filter(c => c !== 'ALL'), [story.countries])
  const filteredPins = useMemo(() => story.pins.filter(p => p !== 'ALL'), [story.pins])

  const getCountryDelay = (country) => {
    const idx = filteredCountries.indexOf(country)
    return idx >= 0 ? idx * COUNTRY_DELAY : 0
  }
  const getPinDelay = (name) => {
    const idx = filteredPins.indexOf(name)
    return idx >= 0 ? idx * COUNTRY_DELAY + DOT_ANIMATION : 0
  }

  // Show terminal for non-simple sections (not start/explore)
  const showTerminal = !story.isSimple

  return (
    <div className="scroll-container story-stage" ref={containerRef}>
      <div className="map-fixed-container" inert={!!selectedPin}>
        <div className="top-content">
          {story.isSimple && (
            <div className={`simple-text ${isExplore ? 'explore-mode' : ''}`}>
              {isStart ? 'a map of me' : hoveredPin?.title || ''}
            </div>
          )}
          {!story.isSimple && story.cityLabel && (
            <div className="city-label visible">{story.cityLabel}</div>
          )}
        </div>

        <div className="map-wrapper">
          <svg viewBox={`0 0 ${mapData.width} ${mapData.height}`} className={`dotted-map ${isExplore ? 'explore-mode' : ''}`} key={animationKey} role="group" aria-label={isExplore ? 'Explore places and ideas' : story.cityLabel || 'World map — my story'}>
            {/* Map dots */}
            {mapData.dots.map((p, i) => {
              const state = getDotState(p.country)
              const isAnim = animationPhase === 'animating' && state === 'current'
              // In explore mode: visited = light blue
              const exploreClass = isExplore && p.visited ? 'visited' : ''
              return (
                <circle
                  key={i}
                  cx={p.x} cy={p.y} r={0.22}
                  className={`map-dot dot-${state} ${isAnim ? 'animating' : ''} ${exploreClass}`}
                  style={isAnim ? { animationDelay: `${getCountryDelay(p.country)}s` } : {}}
                />
              )
            })}

            {/* Story mode: Shadow dots at pin locations (animate with country) */}
            {!isExplore && mapData.storyPins.map(pin => {
              const state = getPinState(pin.name)
              if (state !== 'current') return null
              const isAnim = animationPhase === 'animating'
              const idx = story.pins.filter(p => p !== 'ALL').indexOf(pin.name)
              return (
                <circle
                  key={`shadow-${pin.name}`}
                  cx={pin.x} cy={pin.y} r={0.22}
                  className={`map-dot dot-current ${isAnim ? 'animating' : ''}`}
                  style={isAnim ? { animationDelay: `${idx * COUNTRY_DELAY}s` } : {}}
                />
              )
            })}

            {/* Story mode: City pins */}
            {!isExplore && mapData.storyPins.map(pin => {
              const state = getPinState(pin.name)
              const isAnim = animationPhase === 'animating' && state === 'current'
              return (
                <circle
                  key={`pin-${pin.name}`}
                  cx={pin.x} cy={pin.y} r={0.5}
                  className={`city-pin pin-${pin.category} pin-state-${state} ${isAnim ? 'animating' : ''}`}
                  style={isAnim ? { animationDelay: `${getPinDelay(pin.name)}s` } : {}}
                />
              )
            })}

            {/* Large invisible targets keep the small dots easy to hit. */}
            {isExplore && mapData.explorePins.map(pin => (
              <g key={`explore-${pin.name}`} className={`explore-pin-group ${hoveredPin?.id === pin.id ? 'is-hovered' : ''}`}
                role="button" tabIndex={0} aria-label={`Open ${pin.title}, ${pin.name}`}
                onMouseEnter={() => setHoveredPin(pin)} onMouseLeave={() => setHoveredPin(null)}
                onFocus={() => setHoveredPin(pin)} onBlur={() => setHoveredPin(null)}
                onClick={() => setSelectedPin(pin)}
                onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedPin(pin) } }}>
                <circle cx={pin.x} cy={pin.y} r={2.4} className="explore-pin-target" />
                <circle cx={pin.x} cy={pin.y} r={1.2} className="explore-pin-glow" />
                <circle cx={pin.x} cy={pin.y} r={0.5} className="explore-pin" />
              </g>
            ))}
          </svg>
        </div>

        {/* Terminal box - always in DOM to prevent layout shift */}
        <StoryTerminal key={story.id} text={story.text} visible={showTerminal} reducedMotion={reducedMotion} />

        {isExplore && (
          <div className="map-explore-footer">
            <div className="map-legend">
              <div className="legend-item"><span className="legend-dot visited" /><span className="legend-label">visited</span></div>
              <div className="legend-item"><span className="legend-dot clickable" /><span className="legend-label">ideas</span></div>
            </div>
            {pinsStatus !== 'ready' && <p className="map-data-status" role="status">{pinsStatus === 'loading' ? 'locating ideas…' : 'The map’s notes are unavailable. Try refreshing in a moment.'}</p>}
          </div>
        )}

        <nav className="story-route" aria-label="My story — choose a stop">
          <span className="story-route-hint">{isExplore ? '' : animationPhase === 'animating' ? '…' : 'scroll ↓'}</span>
          <div className="story-route-stops">
            {STORY_SECTIONS.map((section, index) => (
              <button type="button" key={section.id} className={`${index === currentSection ? 'active' : ''} ${index < currentSection ? 'passed' : ''} ${section.id === 'explore' ? 'final-stop' : ''}`}
                aria-current={index === currentSection ? 'step' : undefined} aria-label={index === 5 ? 'Go directly to the full map' : `Go to ${ROUTE_STOPS[index]}`}
                onClick={() => goTo(index)}>
                <span className="route-dot" /><span className="route-label">{ROUTE_STOPS[index]}{index === 5 ? ' ↗' : ''}</span>
              </button>
            ))}
          </div>
          <div className="story-step-buttons">
            <button type="button" aria-label="Previous chapter" disabled={isStart || animationPhase === 'animating'} onClick={() => goTo(currentSection - 1)}>←</button>
            <span>{String(currentSection + 1).padStart(2, '0')} / 06</span>
            <button type="button" aria-label="Next chapter" disabled={isExplore || animationPhase === 'animating'} onClick={() => goTo(currentSection + 1)}>→</button>
          </div>
        </nav>
      </div>
      {selectedPin && <PinPage pin={selectedPin} onClose={closePin} />}
    </div>
  )
}

export default WorldMap
