import { useState, useEffect, useMemo, useRef } from 'react'
import DottedMap from 'dotted-map'
import { fetchPins } from '../lib/supabase'

// Configuration
const ANIMATION_DURATION = 2400
const COUNTRY_DELAY = 0.6 // seconds between country animations
const DOT_ANIMATION = 1.2 // seconds for dot glow animation
const TYPEWRITER_SPEED = 25 // ms per character

// Parse markdown-style links: [text](url)
function parseLinks(text) {
  if (!text) return text
  const regex = /\[([^\]]+)\]\(([^)]+)\)/g
  const parts = []
  let lastIndex = 0
  let match

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    parts.push(
      <a key={match.index} href={match[2]} target="_blank" rel="noopener noreferrer">
        {match[1]}
      </a>
    )
    lastIndex = regex.lastIndex
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length > 0 ? parts : text
}

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

function WorldMap() {
  const [currentSection, setCurrentSection] = useState(0)
  const [animationPhase, setAnimationPhase] = useState('done')
  const [animationKey, setAnimationKey] = useState(0)
  const [displayedText, setDisplayedText] = useState('')
  const [selectedPin, setSelectedPin] = useState(null)
  const [explorePinsData, setExplorePinsData] = useState([])
  const containerRef = useRef(null)
  const timerRef = useRef(null)
  const typewriterRef = useRef(null)

  // Fetch pins data from Supabase on mount and when window regains focus
  useEffect(() => {
    const loadPins = async () => {
      const pins = await fetchPins()
      if (pins) setExplorePinsData(pins)
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

  // Handle section change - trigger animation and clear text
  useEffect(() => {
    clearTimeout(timerRef.current)
    clearInterval(typewriterRef.current)
    setDisplayedText('') // Clear text immediately on section change
    setSelectedPin(null) // Close any open modal

    if (!story.isSimple && story.countries.length > 0) {
      setAnimationPhase('animating')
      setAnimationKey(k => k + 1)
      timerRef.current = setTimeout(() => setAnimationPhase('done'), ANIMATION_DURATION)
    } else {
      setAnimationPhase('done')
    }
    return () => {
      clearTimeout(timerRef.current)
      clearInterval(typewriterRef.current)
    }
  }, [currentSection, story.isSimple, story.countries.length])

  // Typewriter effect - runs when animation is done
  useEffect(() => {
    if (animationPhase === 'done' && !story.isSimple && story.text) {
      const text = story.text
      let index = 0
      setDisplayedText('')

      typewriterRef.current = setInterval(() => {
        index++
        setDisplayedText(text.slice(0, index))
        if (index >= text.length) {
          clearInterval(typewriterRef.current)
        }
      }, TYPEWRITER_SPEED)
    }
    return () => clearInterval(typewriterRef.current)
  }, [animationPhase, story.isSimple, story.text])

  // Handle scroll
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onScroll = () => {
      const progress = container.scrollTop / (container.scrollHeight - container.clientHeight)
      const section = Math.min(Math.floor(progress * STORY_SECTIONS.length), STORY_SECTIONS.length - 1)
      if (section !== currentSection) setCurrentSection(section)
    }

    container.addEventListener('scroll', onScroll)
    return () => container.removeEventListener('scroll', onScroll)
  }, [currentSection])

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
    <div className="scroll-container" ref={containerRef}>
      <div className="scroll-content">
        {STORY_SECTIONS.map((_, i) => <div key={i} className="scroll-section" />)}
      </div>

      <div className="map-fixed-container">
        <div className="top-content">
          {story.isSimple && (
            <div className={`simple-text ${isExplore ? 'explore-mode' : ''}`}>
              {isStart ? 'scroll' : story.text}
            </div>
          )}
          {!story.isSimple && story.cityLabel && (
            <div className="city-label visible">{story.cityLabel}</div>
          )}
        </div>

        <div className="map-wrapper">
          <svg viewBox={`0 0 ${mapData.width} ${mapData.height}`} className={`dotted-map ${isExplore ? 'explore-mode' : ''}`} key={animationKey}>
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

            {/* Explore mode: Green neon pins */}
            {isExplore && mapData.explorePins.map(pin => (
              <g key={`explore-${pin.name}`} className="explore-pin-group" onClick={() => setSelectedPin(pin)}>
                <circle cx={pin.x} cy={pin.y} r={1.2} className="explore-pin-glow" />
                <circle cx={pin.x} cy={pin.y} r={0.5} className="explore-pin" />
              </g>
            ))}
          </svg>
        </div>

        {/* Pin detail modal - full page */}
        {selectedPin && (
          <div className="pin-modal-overlay">
            <div className="pin-modal-full" onClick={e => e.stopPropagation()}>
              <button className="pin-modal-back" onClick={() => setSelectedPin(null)}>
                ← back
              </button>

              <div className="pin-modal-content">
                <h1 className="pin-modal-title">{selectedPin.title}</h1>

                <section className="pin-section">
                  <p className="pin-intro">{parseLinks(selectedPin.intro)}</p>
                </section>

                <section className="pin-section">
                  <h3 className="pin-section-title">questions i have</h3>
                  <ul className="pin-list">
                    {selectedPin.questions?.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </section>

                {selectedPin.writing?.length > 0 && (
                  <section className="pin-section">
                    <h3 className="pin-section-title">writing & projects</h3>
                    <ul className="pin-list">
                      {selectedPin.writing.map((w, i) => (
                        <li key={i}>
                          <a href={w.url} target="_blank" rel="noopener noreferrer">{w.title}</a>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <section className="pin-section">
                  <h3 className="pin-section-title">things i've read</h3>
                  <ul className="pin-list">
                    {selectedPin.read?.map((r, i) => (
                      <li key={i}><em>{r.title}</em> — {r.author}</li>
                    ))}
                  </ul>
                </section>

                <section className="pin-section">
                  <h3 className="pin-section-title">things i want to read</h3>
                  <ul className="pin-list">
                    {selectedPin.toRead?.map((r, i) => (
                      <li key={i}><em>{r.title}</em> — {r.author}</li>
                    ))}
                  </ul>
                </section>
              </div>

              {selectedPin.music && (
                <div className="pin-music-player">
                  <div className="music-cover">
                    <div className="music-cover-placeholder">♫</div>
                  </div>
                  <div className="music-info">
                    <span className="music-title">{selectedPin.music.title}</span>
                    <span className="music-artist">{selectedPin.music.artist}</span>
                  </div>
                  <div className="music-controls">
                    <button className="music-btn">▶</button>
                    <button className="music-btn">🔊</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Terminal box - always in DOM to prevent layout shift */}
        <div className="terminal-box" style={{ visibility: showTerminal ? 'visible' : 'hidden' }}>
          <span className="terminal-prompt">&gt;</span>
          <span className="terminal-text">{displayedText}<span className="terminal-cursor" /></span>
        </div>

        {isExplore && (
          <div className="map-legend">
            <div className="legend-item"><span className="legend-dot visited" /><span className="legend-label">visited</span></div>
            <div className="legend-item"><span className="legend-dot clickable" /><span className="legend-label">click me</span></div>
          </div>
        )}

        {isStart && (
          <div className="scroll-indicator"><div className="scroll-arrow" /></div>
        )}
      </div>
    </div>
  )
}

export default WorldMap
