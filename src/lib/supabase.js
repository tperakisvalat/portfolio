import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Fetch all pins from database
export async function fetchPins() {
  const { data, error } = await supabase
    .from('pins')
    .select('*')
    .order('id')

  if (error) {
    console.error('Error fetching pins:', error)
    return null
  }

  // Transform from snake_case (database) to camelCase (frontend)
  return data.map(pin => ({
    id: pin.id,
    name: pin.name,
    lat: pin.lat,
    lng: pin.lng,
    title: pin.title,
    intro: pin.intro,
    questions: pin.questions || [],
    writing: pin.writing || [],
    read: pin.read || [],
    toRead: pin.to_read || [],
    music: pin.music || {}
  }))
}

// Update a single pin
export async function updatePin(pin) {
  const { error } = await supabase
    .from('pins')
    .update({
      name: pin.name,
      lat: pin.lat,
      lng: pin.lng,
      title: pin.title,
      intro: pin.intro,
      questions: pin.questions,
      writing: pin.writing,
      read: pin.read,
      to_read: pin.toRead,
      music: pin.music
    })
    .eq('id', pin.id)

  if (error) {
    console.error('Error updating pin:', error)
    return false
  }
  return true
}

// Update all pins at once
export async function updateAllPins(pins) {
  const results = await Promise.all(pins.map(pin => updatePin(pin)))
  return results.every(r => r === true)
}

// Auth helpers
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  })

  if (error) {
    return { success: false, error: error.message }
  }
  return { success: true, user: data.user }
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  return !error
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession()
  return session
}
