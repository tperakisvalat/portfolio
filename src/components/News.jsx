import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import useReducedMotion from '../lib/useReducedMotion'
import useNewsTransition from '../lib/useNewsTransition'
import DottedMap from 'dotted-map'
import Header from './Header'
import NewsProse from './NewsProse'
import { briefSummary } from '../../shared/news-prose'
import './News.css'
import { useNewsQuery } from '../lib/newsApi'

const ACCENTS = { macro: '#88ccff', politics: '#ff6666', business: '#ff9944', tech: '#44ff88' }

const THEMES = [
  { key: 'macro', number: '01', label: 'macro' },
  { key: 'politics', number: '02', label: 'politics' },
  { key: 'business', number: '03', label: 'business' },
  { key: 'tech', number: '04', label: 'tech' },
]

const QUESTIONS = [
  { key: 'rates', question: 'The price of money' },
  { key: 'growth', question: 'What makes economies grow?' },
  { key: 'dollar', question: 'The dollar system' },
  { key: 'recession', question: 'Where does fragility build?' },
]

const MAP_POINTS = {
  politics: [
    { key: 'france', label: 'france', lat: 46.5, lng: 2.5, intensity: 2 },
    { key: 'europe', label: 'europe', lat: 49.5, lng: 25, intensity: 3 },
    { key: 'gulf', label: 'gulf', lat: 26, lng: 51, intensity: 3 },
    { key: 'east-asia', label: 'east asia', lat: 27, lng: 121, intensity: 2 },
    { key: 'sahel', label: 'sahel', lat: 15, lng: 1, intensity: 2 },
    { key: 'americas', label: 'americas', lat: 34, lng: -91, intensity: 1 },
  ],
  business: [
    { key: 'north-america', label: 'north america', lat: 39, lng: -99, intensity: 3 },
    { key: 'europe', label: 'europe', lat: 50, lng: 12, intensity: 2 },
    { key: 'china', label: 'china', lat: 35, lng: 105, intensity: 3 },
    { key: 'india', label: 'india', lat: 22, lng: 79, intensity: 2 },
    { key: 'gulf', label: 'gulf', lat: 25, lng: 50, intensity: 2 },
    { key: 'latin-america', label: 'latin america', lat: -14, lng: -59, intensity: 1 },
  ],
}

const INDUSTRIES = [
  { key: 'compute', label: 'compute', value: '31' },
  { key: 'finance', label: 'financials', value: '18' },
  { key: 'industrial', label: 'industrial', value: '14' },
  { key: 'consumer', label: 'consumer', value: '12' },
  { key: 'health', label: 'health', value: '11' },
  { key: 'energy', label: 'energy', value: '8' },
  { key: 'other', label: 'other', value: '6' },
]

const TECH_LAYERS = [
  { key: 'research', number: '01', label: 'research', measure: 'ideas' },
  { key: 'models', number: '02', label: 'frontier models', measure: 'capability' },
  { key: 'infrastructure', number: '03', label: 'infrastructure', measure: 'scale' },
  { key: 'applications', number: '04', label: 'applications', measure: 'utility' },
  { key: 'adoption', number: '05', label: 'adoption', measure: 'reality' },
]

const READING = {
  rates: ['The price of money'],
  growth: ['Is the world slowing?'],
  dollar: ['The dollar system'],
  recession: ['Reading the cycle'],
  france: ['France'],
  europe: ['Europe'],
  gulf: ['The Gulf'],
  'east-asia': ['The most consequential strait'],
  sahel: ['A region breaking formation'],
  americas: ['The political cycle'],
  'north-america': ['Scale and concentration'],
  china: ['Capacity, demand, transition'],
  india: ['The scale-up economy'],
  'latin-america': ['Resources and reinvention'],
  compute: ['The compute stack'],
  finance: ['Finance under new pressure'],
  industrial: ['The physical economy returns'],
  consumer: ['The pressured consumer'],
  health: ['Biology meets scale'],
  energy: ['The energy constraint'],
  other: ['The long tail'],
  research: ['Where capability begins'],
  models: ['The capability frontier'],
  infrastructure: ['The machine beneath intelligence'],
  applications: ['Capability finds a job'],
  adoption: ['How work changes'],
}

function NewsNavigation({ onBack, trail, onBrief }) {
  return (
    <nav className="n3-navigation" aria-label="News navigation">
      <button type="button" onClick={onBack || (() => onBrief('themes'))}>{onBack ? '← back' : 'news /'}</button>
      <span>{trail}</span>
      <button type="button" onClick={() => onBrief('brief')}>the brief ↓</button>
      <div className="n3-read-progress" aria-hidden="true" />
    </nav>
  )
}

function DailyBrief({ onExplore, onJump }) {
  const { data, loading, error } = useNewsQuery('/brief/latest', { refreshInterval: 30000 })
  const edition = data?.edition
  const stories = edition?.content.stories || []
  const headlines = edition?.content.headlines || []
  return (
    <section className="n2-daily" id="daily-brief" aria-labelledby="brief-title">
      <header className="n2-daily-head">
        <div><span>{edition?.content.date || ''}</span><small>{edition ? briefSummary(stories.length,headlines.length) : loading ? 'loading…' : error || 'first edition forthcoming'}</small>{edition && <small>as of <time dateTime={edition.content.cutoff}>{new Date(edition.content.cutoff).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',timeZone:'America/New_York',timeZoneName:'short'})}</time></small>}</div>
        <h2 id="brief-title">the brief<span>.</span></h2>
        <nav aria-label="Jump to a category">
          {!!headlines.length && <button type="button" onClick={() => onJump('brief-elsewhere')}>elsewhere ↓</button>}
          {THEMES.filter(theme => stories.some(story => story.pillar === theme.key)).map(theme => <button type="button" key={theme.key} onClick={() => onJump(`brief-${theme.key}`)} style={{ '--n2-accent': ACCENTS[theme.key] }}><span>{theme.number}</span>{theme.label} ↓</button>)}
        </nav>
      </header>
      {!!headlines.length && <section className="n4-agenda" id="brief-elsewhere" aria-labelledby="elsewhere-title">
        <header><h3 id="elsewhere-title">elsewhere</h3><span>selected developments / {edition.content.date}</span></header>
        <div>{headlines.map(headline => <article key={headline.id}>
          <small>{headline.pillar} / {headline.eventDate}</small><h4>{headline.title}</h4><NewsProse body={headline.body}/>
          <div className="n4-agenda-sources">{headline.sources.map(source => <a key={source.itemId} href={source.url} target="_blank" rel="noopener noreferrer">{source.publisher} ↗</a>)}</div>
        </article>)}</div>
      </section>}
      <div className="n2-daily-sections">
        {THEMES.filter(theme => stories.some(story => story.pillar === theme.key)).map(theme => (
          <section className="n2-daily-section" id={`brief-${theme.key}`} key={theme.key} style={{ '--n2-accent': ACCENTS[theme.key] }} aria-labelledby={`label-${theme.key}`}>
            <header>
              <span>{theme.number} /</span>
              <h3 id={`label-${theme.key}`}>{theme.label}</h3>
              <button type="button" onClick={event => onExplore(theme.key, event.currentTarget)} aria-label={`Explore ${theme.label}`}>explore ↗</button>
            </header>
            <div className="n3-stories">
              {stories.filter(story => story.pillar === theme.key).map((story, index) => (
                <article key={story.id}>
                  <span className="n3-story-number">{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <h4>{story.title}</h4>
                    <NewsProse body={story.body} visuals={story.visuals}/>
                    {story.sources.map(source => <a key={source.itemId} className="n2-source-link" href={source.url} target="_blank" rel="noreferrer">
                      <span>{source.publisher}</span><strong>{source.title}</strong><i aria-hidden="true">↗</i>
                    </a>)}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
      <footer className="n2-daily-end"><button type="button" onClick={() => onJump('news-themes')}>themes ↑</button>{edition && <a href="/news/brief.txt">text ↗</a>}</footer>
    </section>
  )
}

function ThemeDoor({ theme, onOpen }) {
  return (
    <button className={`n3-theme-door theme-${theme.key}`} data-news-node={`theme-${theme.key}`} type="button" onClick={event => onOpen(theme.key, event.currentTarget)} style={{ '--n2-accent': ACCENTS[theme.key] }}>
      <span className="n3-door-number" aria-hidden="true">{theme.number}</span>
      <div className="n3-door-copy"><h2 data-news-label>{theme.label}</h2></div>
      <i className="n3-door-arrow" aria-hidden="true">↗</i>
      {theme.key === 'macro' && <svg className="theme-curve" viewBox="0 0 400 100" aria-hidden="true"><path className="curve-axis" d="M0 80H400" /><path className="curve-trace" pathLength="1" d="M0 80L36 80L58 60L83 70L108 42L136 53L162 22L182 62L209 49L237 68L260 39L287 48L317 14L344 25L371 7L400 7" /><circle cx="371" cy="7" r="3" /></svg>}
      {theme.key === 'politics' && <span className="theme-boundaries" aria-hidden="true"><i /><i /><i /><b /><b /><b /></span>}
      {theme.key === 'business' && <span className="theme-currencies" aria-hidden="true">{['$', '€', '¥', '£', '₿', '$'].map((glyph, i) => <span key={i} style={{ '--i': i, '--currency-x': `${[-68, -33, 8, 40, 71, 94][i]}px`, '--currency-y': `${[-50, -102, -78, -120, -62, -20][i]}px`, '--rotation': `${[-28, 14, -12, 27, -17, 35][i]}deg` }}>{glyph}</span>)}</span>}
      {theme.key === 'tech' && <span className="theme-glitch" aria-hidden="true"><span>t∑ch</span><span>t&lt;ch</span></span>}
    </button>
  )
}

function ThemesIndex({ onOpen, onBrief }) {
  return (
    <section className="n2-themes" id="news-themes" aria-labelledby="themes-title">
      <div className="n2-section-label"><h1 id="themes-title">themes</h1></div>
      <div className="n2-theme-grid">{THEMES.map(theme => <ThemeDoor key={theme.key} theme={theme} onOpen={onOpen} />)}</div>
      <button type="button" className="n3-brief-cue" onClick={onBrief}><strong>the brief</strong><i aria-hidden="true">↓</i></button>
    </section>
  )
}

function PredictionQuestions({ onRead }) {
  return (
    <section className="n2-questions" style={{ '--n2-accent': ACCENTS.macro }}>
      <header><h1 data-news-heading>macro</h1></header>
      <div className="n2-question-list">
        {QUESTIONS.map((item, index) => (
          <button type="button" data-news-node={`reading-${item.key}`} onClick={event => onRead(item.key, event.currentTarget)} key={item.key}>
            <span>0{index + 1}</span><p data-news-label>{item.question}</p>
            <div aria-hidden="true">↗</div>
          </button>
        ))}
      </div>
    </section>
  )
}

function WorldMap({ kind, onRead }) {
  const points = MAP_POINTS[kind]
  const map = useMemo(() => {
    const dotted = new DottedMap({ height: 56, grid: 'diagonal' })
    points.forEach(point => dotted.addPin({ lat: point.lat, lng: point.lng, data: point }))
    const mapPoints = dotted.getPoints()
    const xs = mapPoints.map(point => point.x)
    const ys = mapPoints.map(point => point.y)
    return { points: mapPoints, width: Math.max(...xs) + 1, height: Math.max(...ys) + 1 }
  }, [points])
  return (
    <section className="n2-map" style={{ '--n2-accent': ACCENTS[kind] }}>
      <div className="n2-map-top"><span data-news-heading>{kind} / geography</span></div>
      <div className="n2-map-stage">
        <svg viewBox={`0 0 ${map.width} ${map.height}`} role="group" aria-label={`${kind} world map`}>
          {map.points.map((point, index) => point.data?.key ? (
            <g className="n2-map-point" data-news-node={`reading-${point.data.key}`} key={`${point.data.key}-${index}`} role="button" tabIndex="0" aria-label={`Read about ${point.data.label}`} onClick={event => onRead(point.data.key, event.currentTarget)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onRead(point.data.key, event.currentTarget) } }}>
              <circle className="hit-area" cx={point.x} cy={point.y} r={2.7} />
              <circle className="ring" cx={point.x} cy={point.y} r={1.2 + point.data.intensity * 0.22} />
              <circle className="core" cx={point.x} cy={point.y} r={0.48} />
              <text x={point.x + 1.5} y={point.y - 1.15}>{point.data.label}</text>
            </g>
          ) : <circle className="dot" key={index} cx={point.x} cy={point.y} r={0.17} />)}
        </svg>
      </div>
    </section>
  )
}

function BusinessChoice({ onChoose }) {
  return (
    <section className="n2-business-choice" style={{ '--n2-accent': ACCENTS.business }}>
      <header><h1 data-news-heading>business</h1></header>
      <div>
        <button type="button" data-news-node="view-geography" onClick={event => onChoose('geography', event.currentTarget)}><span aria-hidden="true">01</span><h2 data-news-label>geography</h2><i aria-hidden="true">→</i></button>
        <button type="button" data-news-node="view-industries" onClick={event => onChoose('industries', event.currentTarget)}><span aria-hidden="true">02</span><h2 data-news-label>industries</h2><i aria-hidden="true">→</i></button>
      </div>
    </section>
  )
}

function IndustryMap({ onRead }) {
  return (
    <section className="n2-industry" style={{ '--n2-accent': ACCENTS.business }}>
      <div className="n2-map-top"><span data-news-heading>business / industries</span><span>illustrative weights</span></div>
      <div className="n2-industry-map">
        {INDUSTRIES.map(item => (
          <button className={item.key} data-news-node={`reading-${item.key}`} type="button" onClick={event => onRead(item.key, event.currentTarget)} key={item.key}>
            <span data-news-label>{item.label}</span><strong>{item.value}<i>%</i></strong>
          </button>
        ))}
      </div>
    </section>
  )
}

function TechFunnel({ onRead }) {
  return (
    <section className="n2-tech" style={{ '--n2-accent': ACCENTS.tech }}>
      <div className="n2-map-top"><span data-news-heading>tech</span></div>
      <div className="n2-funnel">
        {TECH_LAYERS.map(layer => (
          <button type="button" data-news-node={`reading-${layer.key}`} key={layer.key} onClick={event => onRead(layer.key, event.currentTarget)}>
            <span aria-hidden="true">{layer.number}</span><h2 data-news-label>{layer.label}</h2><i aria-hidden="true">→</i>
          </button>
        ))}
      </div>
    </section>
  )
}

function ReadingPage({ readingKey, theme }) {
  const [offset, setOffset] = useState(0)
  const [title] = READING[readingKey] || READING.research
  const { data, loading, error } = useNewsQuery(`/library?topic=${encodeURIComponent(`${theme}:${readingKey}`)}&offset=${offset}`)
  const sources = data?.items || []
  return (
    <article className="n2-reading">
      <header><span>{theme} / {readingKey.replaceAll('-', ' ')}</span><h1 data-news-heading>{title}</h1></header>
      <TopicMarkets topic={`${theme}:${readingKey}`}/>
      <div className="n2-reading-order"><span>{loading ? 'loading…' : error || `${sources.length} entries`}</span><span>newest ↓</span></div>
      {!loading && !error && !sources.length && <p className="n2-empty">Nothing published here yet.</p>}
      <div className="n2-reading-list">
        {sources.map(source => (
          <a href={source.url} target="_blank" rel="noreferrer" key={source.id} title={source.annotation}>
            <time dateTime={source.published_at || undefined}>{source.published_at ? new Date(source.published_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'date unknown'}</time>
            <span>{source.kind}</span>
            <small>{source.publisher}</small>
            <strong>{source.title}</strong>
            <i aria-hidden="true">↗</i>
          </a>
        ))}
      </div>
      <nav className="n2-library-pages" aria-label="Library pages">{offset > 0 && <button onClick={() => setOffset(Math.max(0, offset - 30))}>← newer</button>}{data?.nextOffset != null && <button onClick={() => setOffset(data.nextOffset)}>older →</button>}</nav>
    </article>
  )
}

function TopicMarkets({ topic }) {
  const {data}=useNewsQuery(`/markets?topic=${encodeURIComponent(topic)}`)
  if(!data?.items?.length)return null
  return <section className="n2-topic-markets" aria-label="Prediction markets">{data.items.map(item=><div key={item.id}>{item.quote?<><a href={item.quote.url} target="_blank" rel="noreferrer">{item.quote.title} ↗</a><span>{item.quote.status==='active'?item.quote.outcomes.map(outcome=>`${outcome.label} ${outcome.probability==null?'—':`${Math.round(outcome.probability*100)}%`}`).join(' / '):item.quote.status}</span><small>{item.provider} / {item.quote.priceType} / checked {new Date(item.checkedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</small></>:<small>{item.provider} / quote unavailable</small>}</div>)}</section>
}

function News() {
  const [params, setParams] = useSearchParams()
  const theme = THEMES.some(item => item.key === params.get('theme')) ? params.get('theme') : null
  const businessView = theme === 'business' && ['geography', 'industries'].includes(params.get('view')) ? params.get('view') : null
  const choices = theme === 'macro' ? QUESTIONS : theme === 'politics' ? MAP_POINTS.politics : theme === 'business' ? [...MAP_POINTS.business, ...INDUSTRIES] : theme === 'tech' ? TECH_LAYERS : []
  const reading = choices.some(item => item.key === params.get('reading')) ? params.get('reading') : null
  const reducedMotion = useReducedMotion()
  const readerRef = useRef(null)
  const positionsRef = useRef(new Map())
  const currentKeyRef = useRef(params.toString())
  const jumpRef = useRef(null)
  const viewRef = useRef(null)
  const viewKey = params.toString()
  const transitionTo = useNewsTransition({ readerRef, viewRef, viewKey, reducedMotion })

  useEffect(() => {
    const previousTitle = document.title
    document.title = 'tpv | news'
    return () => { document.title = previousTitle }
  }, [])

  const jumpTo = (id, immediate = false) => {
    const node = document.getElementById(id)
    if (!node) return
    node.scrollIntoView({ behavior: reducedMotion || immediate ? 'instant' : 'smooth', block: 'start' })
  }

  useLayoutEffect(() => {
    const reader = readerRef.current
    const changed = currentKeyRef.current !== viewKey
    currentKeyRef.current = viewKey
    reader.scrollTop = positionsRef.current.get(viewKey) || 0
    if (jumpRef.current) {
      const id = jumpRef.current
      jumpRef.current = null
      // Set the destination before its snapshot; don't scroll during a reveal.
      jumpTo(id, true)
    }
    const extent = reader.scrollHeight - reader.clientHeight
    reader.style.setProperty('--read-progress', extent > 0 ? reader.scrollTop / extent : 0)
    if (changed) viewRef.current?.focus({ preventScroll: true })
  }, [viewKey])

  const navigate = (values, options = {}) => {
    const nextParams = Object.fromEntries(Object.entries(values).filter(([, value]) => value))
    const targetKey = new URLSearchParams(nextParams).toString()
    if (targetKey === viewKey) return
    positionsRef.current.set(currentKeyRef.current, readerRef.current.scrollTop)
    transitionTo({ ...options, targetKey, update: () => setParams(nextParams) })
  }
  const openTheme = (key, source) => navigate({ theme: key }, { source })
  const openReading = (key, source) => navigate({ theme, view: businessView, reading: key }, { source })
  const goBack = () => {
    const options = { direction: 'out', returnTo: reading ? `reading-${reading}` : businessView ? `view-${businessView}` : `theme-${theme}` }
    if (reading) navigate({ theme, view: businessView }, options)
    else if (businessView) navigate({ theme }, options)
    else navigate({}, options)
  }
  const showBrief = destination => {
    const id = destination === 'themes' ? 'news-themes' : 'daily-brief'
    if (theme) { jumpRef.current = id; navigate({}, { direction: 'out', returnTo: `theme-${theme}` }) }
    else jumpTo(id)
  }

  useEffect(() => {
    if (!theme) return
    const onKey = event => {
      if (event.key === 'Escape' && !event.target.closest?.('input, textarea, select')) {
        goBack()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [theme, businessView, reading, reducedMotion, setParams])

  const onScroll = () => {
    const reader = readerRef.current
    positionsRef.current.set(currentKeyRef.current, reader.scrollTop)
    const extent = reader.scrollHeight - reader.clientHeight
    reader.style.setProperty('--read-progress', extent > 0 ? reader.scrollTop / extent : 0)
  }

  const renderContent = () => {
    if (reading) return <ReadingPage readingKey={reading} theme={theme} />
    if (!theme) return <><ThemesIndex onOpen={openTheme} onBrief={() => showBrief('brief')} /><DailyBrief onExplore={openTheme} onJump={jumpTo} /></>
    if (theme === 'macro') return <PredictionQuestions onRead={openReading} />
    if (theme === 'politics') return <WorldMap kind="politics" onRead={openReading} />
    if (theme === 'tech') return <TechFunnel onRead={openReading} />
    if (!businessView) return <BusinessChoice onChoose={(view, source) => navigate({ theme, view }, { source })} />
    if (businessView === 'geography') return <WorldMap kind="business" onRead={openReading} />
    return <IndustryMap onRead={openReading} />
  }

  const trail = [theme, businessView, reading?.replaceAll('-', ' ')].filter(Boolean).join(' / ')
  return (
    <div className="news-reader" ref={readerRef} onScroll={onScroll}>
      <Header />
      <main>
        <NewsNavigation onBack={theme ? goBack : null} trail={trail} onBrief={showBrief} />
        <div className="n3-view" key={viewKey} ref={viewRef} tabIndex={-1}>{renderContent()}</div>
      </main>
    </div>
  )
}

export default News
