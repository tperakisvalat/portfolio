import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, fetchPins, updateAllPins, signIn, signOut } from '../lib/supabase'

function Admin() {
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pins, setPins] = useState([])
  const [selectedPin, setSelectedPin] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const navigate = useNavigate()

  // Handle auth state changes (includes initial session check)
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session) {
        setIsLoggedIn(true)
        try {
          const pinsData = await fetchPins()
          if (pinsData) setPins(pinsData)
        } catch (err) {
          console.error('Failed to fetch pins:', err)
        }
      } else {
        setIsLoggedIn(false)
        setPins([])
      }
      setIsLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  const handleLogin = async (e) => {
    e.preventDefault()
    setError('')

    const result = await signIn(email, password)
    if (result.success) {
      setIsLoggedIn(true)
      const pinsData = await fetchPins()
      if (pinsData) setPins(pinsData)
    } else {
      setError(result.error || 'Invalid credentials')
    }
  }

  const handleLogout = async () => {
    await signOut()
    setIsLoggedIn(false)
    navigate('/')
  }

  const handleSave = async () => {
    setSaving(true)
    const success = await updateAllPins(pins)
    setSaving(false)

    if (success) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } else {
      setError('Failed to save changes')
      setTimeout(() => setError(''), 3000)
    }
  }

  const updatePinField = (pinId, field, value) => {
    setPins(pins.map(p => p.id === pinId ? { ...p, [field]: value } : p))
    // Update selectedPin to reflect changes immediately
    if (selectedPin?.id === pinId) {
      setSelectedPin(prev => ({ ...prev, [field]: value }))
    }
  }

  const updateArrayItem = (pinId, field, index, key, value) => {
    setPins(pins.map(p => {
      if (p.id !== pinId) return p
      const arr = [...p[field]]
      arr[index] = { ...arr[index], [key]: value }
      return { ...p, [field]: arr }
    }))
  }

  const addArrayItem = (pinId, field, template) => {
    setPins(pins.map(p => {
      if (p.id !== pinId) return p
      return { ...p, [field]: [...p[field], template] }
    }))
  }

  const removeArrayItem = (pinId, field, index) => {
    setPins(pins.map(p => {
      if (p.id !== pinId) return p
      const arr = [...p[field]]
      arr.splice(index, 1)
      return { ...p, [field]: arr }
    }))
  }

  const updateQuestion = (pinId, index, value) => {
    setPins(pins.map(p => {
      if (p.id !== pinId) return p
      const questions = [...p.questions]
      questions[index] = value
      return { ...p, questions }
    }))
  }

  // Show loading state
  if (isLoading) {
    return (
      <div className="admin-login">
        <div className="admin-login-form">
          <h1>loading...</h1>
        </div>
      </div>
    )
  }

  // Show login form
  if (!isLoggedIn) {
    return (
      <div className="admin-login">
        <form onSubmit={handleLogin} className="admin-login-form">
          <h1>admin</h1>
          {error && <div className="admin-error">{error}</div>}
          <input
            type="email"
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            type="password"
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit">login</button>
          <button type="button" className="admin-back" onClick={() => navigate('/')}>
            ← back to site
          </button>
        </form>
      </div>
    )
  }

  // Get the current version of selectedPin from pins array
  const currentPin = selectedPin ? pins.find(p => p.id === selectedPin.id) : null

  return (
    <div className="admin-panel">
      <div className="admin-header">
        <h1>admin panel</h1>
        <div className="admin-actions">
          {error && <span className="admin-error">{error}</span>}
          <button onClick={handleSave} className={saved ? 'saved' : ''} disabled={saving}>
            {saving ? 'saving...' : saved ? '✓ saved' : 'save changes'}
          </button>
          <button onClick={handleLogout} className="logout">logout</button>
        </div>
      </div>

      <div className="admin-content">
        <div className="admin-sidebar">
          <h3>regions</h3>
          {pins.map(pin => (
            <button
              key={pin.id}
              className={`admin-region-btn ${selectedPin?.id === pin.id ? 'active' : ''}`}
              onClick={() => setSelectedPin(pin)}
            >
              {pin.title}
            </button>
          ))}
        </div>

        <div className="admin-editor">
          {currentPin ? (
            <div className="admin-form">
              <h2>{currentPin.title}</h2>

              <div className="admin-field">
                <label>Title</label>
                <input
                  type="text"
                  value={currentPin.title}
                  onChange={(e) => updatePinField(currentPin.id, 'title', e.target.value)}
                />
              </div>

              <div className="admin-field">
                <label>Intro</label>
                <textarea
                  value={currentPin.intro}
                  onChange={(e) => updatePinField(currentPin.id, 'intro', e.target.value)}
                  rows={4}
                />
                <small>Tip: Use [link text](url) for hyperlinks</small>
              </div>

              <div className="admin-field">
                <label>Questions</label>
                {currentPin.questions.map((q, i) => (
                  <div key={i} className="admin-array-item">
                    <input
                      type="text"
                      value={q}
                      onChange={(e) => updateQuestion(currentPin.id, i, e.target.value)}
                    />
                    <button onClick={() => removeArrayItem(currentPin.id, 'questions', i)}>×</button>
                  </div>
                ))}
                <button className="admin-add-btn" onClick={() => addArrayItem(currentPin.id, 'questions', '')}>
                  + add question
                </button>
              </div>

              <div className="admin-field">
                <label>Writing & Projects</label>
                {currentPin.writing.map((w, i) => (
                  <div key={i} className="admin-array-item double">
                    <input
                      type="text"
                      placeholder="Title"
                      value={w.title}
                      onChange={(e) => updateArrayItem(currentPin.id, 'writing', i, 'title', e.target.value)}
                    />
                    <input
                      type="text"
                      placeholder="URL"
                      value={w.url}
                      onChange={(e) => updateArrayItem(currentPin.id, 'writing', i, 'url', e.target.value)}
                    />
                    <button onClick={() => removeArrayItem(currentPin.id, 'writing', i)}>×</button>
                  </div>
                ))}
                <button className="admin-add-btn" onClick={() => addArrayItem(currentPin.id, 'writing', { title: '', url: '' })}>
                  + add writing
                </button>
              </div>

              <div className="admin-field">
                <label>Things I've Read</label>
                {currentPin.read.map((r, i) => (
                  <div key={i} className="admin-array-item double">
                    <input
                      type="text"
                      placeholder="Title"
                      value={r.title}
                      onChange={(e) => updateArrayItem(currentPin.id, 'read', i, 'title', e.target.value)}
                    />
                    <input
                      type="text"
                      placeholder="Author"
                      value={r.author}
                      onChange={(e) => updateArrayItem(currentPin.id, 'read', i, 'author', e.target.value)}
                    />
                    <button onClick={() => removeArrayItem(currentPin.id, 'read', i)}>×</button>
                  </div>
                ))}
                <button className="admin-add-btn" onClick={() => addArrayItem(currentPin.id, 'read', { title: '', author: '' })}>
                  + add book
                </button>
              </div>

              <div className="admin-field">
                <label>Things I Want to Read</label>
                {currentPin.toRead.map((r, i) => (
                  <div key={i} className="admin-array-item double">
                    <input
                      type="text"
                      placeholder="Title"
                      value={r.title}
                      onChange={(e) => updateArrayItem(currentPin.id, 'toRead', i, 'title', e.target.value)}
                    />
                    <input
                      type="text"
                      placeholder="Author"
                      value={r.author}
                      onChange={(e) => updateArrayItem(currentPin.id, 'toRead', i, 'author', e.target.value)}
                    />
                    <button onClick={() => removeArrayItem(currentPin.id, 'toRead', i)}>×</button>
                  </div>
                ))}
                <button className="admin-add-btn" onClick={() => addArrayItem(currentPin.id, 'toRead', { title: '', author: '' })}>
                  + add book
                </button>
              </div>

              <div className="admin-field">
                <label>Music</label>
                <div className="admin-array-item double">
                  <input
                    type="text"
                    placeholder="Song Title"
                    value={currentPin.music?.title || ''}
                    onChange={(e) => updatePinField(currentPin.id, 'music', { ...currentPin.music, title: e.target.value })}
                  />
                  <input
                    type="text"
                    placeholder="Artist"
                    value={currentPin.music?.artist || ''}
                    onChange={(e) => updatePinField(currentPin.id, 'music', { ...currentPin.music, artist: e.target.value })}
                  />
                </div>
                <input
                  type="text"
                  placeholder="Audio URL (from Supabase Storage)"
                  value={currentPin.music?.url || ''}
                  onChange={(e) => updatePinField(currentPin.id, 'music', { ...currentPin.music, url: e.target.value })}
                  style={{ marginTop: '10px' }}
                />
              </div>
            </div>
          ) : (
            <div className="admin-empty">
              <p>Select a region to edit</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default Admin
