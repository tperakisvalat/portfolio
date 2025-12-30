import { useState, useEffect } from 'react'

const CLOCKS = [
  { label: 'PARIS', timezone: 'Europe/Paris' },
  { label: 'NEW YORK', timezone: 'America/New_York' },
  { label: 'SHANGHAI', timezone: 'Asia/Shanghai' },
]

const SOCIAL_LINKS = [
  { label: '2026', url: 'https://docs.google.com/document/d/1tBCX9dw0gRl5RnJ1Jujtj04mgdBiQqJe89Dr-OsTynU/edit?tab=t.0' },
  { label: 'substack', url: 'https://substack.com/@timpv' },
  { label: 'linkedin', url: 'https://www.linkedin.com/in/timothee-perakis/' },
  { label: 'x', url: 'https://x.com/tperakisvalat' },
]

function Header() {
  const [time, setTime] = useState(new Date())

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
    <header className="header">
      <div className="header-left">
        <span className="name">tpv</span>
        <div className="clocks">
          {CLOCKS.map(clock => (
            <div key={clock.timezone} className="clock">
              <span className="clock-label">{clock.label}</span>
              <span className="clock-time">{formatTime(clock.timezone)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="header-right">
        {SOCIAL_LINKS.map(link => (
          <a
            key={link.label}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="social-link"
          >
            {link.label}
          </a>
        ))}
      </div>
    </header>
  )
}

export default Header
