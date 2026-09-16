import { useState, useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'

const CLOCKS = [
  { label: 'PARIS', timezone: 'Europe/Paris' },
  { label: 'NEW YORK', timezone: 'America/New_York' },
  { label: 'SHANGHAI', timezone: 'Asia/Shanghai' },
]

const NAV_LINKS = [
  { label: 'news', to: '/news', internal: true },
  { label: 'personal', url: 'https://docs.google.com/document/d/1w6CIFAsuYbnXb_Xj_Mvr4cKZcjGndOvN9j_9TREBDgo/edit?usp=sharing' },
  { label: 'substack', url: 'https://substack.com/@timpv' },
  { label: 'linkedin', url: 'https://www.linkedin.com/in/timothee-perakis/' },
]

function Header() {
  const [time, setTime] = useState(new Date())
  const location = useLocation()
  const headerRef = useRef(null)

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      document.documentElement.style.setProperty('--header-height', `${entry.target.getBoundingClientRect().height}px`)
    })
    observer.observe(headerRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const formatTime = (timezone) => {
    return time.toLocaleTimeString('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    })
  }

  return (
    <header className="header" ref={headerRef}>
      <div className="header-left">
        <Link to="/" className="name">tpv</Link>
        <div className="clocks">
          {CLOCKS.map(clock => (
            <div key={clock.timezone} className="clock">
              <span className="clock-label">{clock.label}</span>
              <span className="clock-time">{formatTime(clock.timezone)}</span>
            </div>
          ))}
        </div>
      </div>

      <nav className="header-right" aria-label="Main navigation">
        {NAV_LINKS.map(link => (
          link.internal ? (
            <Link
              key={link.label}
              to={link.to}
              className={`social-link news-link ${location.pathname.startsWith(link.to) ? 'active' : ''}`}
              aria-current={location.pathname.startsWith(link.to) ? 'page' : undefined}
            >
              <span className="news-link-signal" aria-hidden="true"><i /><i /><i /></span>
              <span>{link.label}</span><span className="news-link-arrow" aria-hidden="true">↗</span>
            </Link>
          ) : (
            <a
              key={link.label}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="social-link"
            >
              {link.label}
            </a>
          )
        ))}
      </nav>
    </header>
  )
}

export default Header
