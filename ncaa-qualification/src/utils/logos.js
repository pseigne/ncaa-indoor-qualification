import { useEffect, useSyncExternalStore } from 'react'

// School logos are optional. A local, untracked team-logos/index.json maps a team name to a logo file
// id; without it (a clean checkout, a failed fetch) every logo falls back to the team's initials.
let map = null
let loading = null
const listeners = new Set()

export function loadLogos() {
  if (loading) return loading
  loading = Promise.resolve()
    .then(() => fetch(`${import.meta.env.BASE_URL}team-logos/index.json`))
    .then(res => (res?.ok ? res.json() : null))
    .then(data => {
      if (!data || typeof data !== 'object' || Array.isArray(data)) return
      map = Object.fromEntries(Object.entries(data).filter(([, id]) => typeof id === 'string' && /^\w+$/.test(id)))
      listeners.forEach(listener => listener())
    })
    .catch(() => {})
  return loading
}

export function resetLogos() {
  map = null
  loading = null
  listeners.forEach(listener => listener())
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useLogos() {
  useEffect(() => { loadLogos() }, [])
  return useSyncExternalStore(subscribe, () => map, () => null)
}

export function cleanTeam(team) {
  return String(team || '').replace(/\s*\([A-Z]\)$/, '').trim()
}

export function teamInitials(team) {
  const name = cleanTeam(team)
  const words = name.replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter(word => word && !/^(of|the|at)$/i.test(word))
  if (words.length > 1) return words.slice(0, 2).map(word => word[0]).join('').toUpperCase()
  return (words[0] || name).slice(0, 2).toUpperCase()
}

// The logo's address when one is known, and the initials to show otherwise.
export function logoFor(team, logos) {
  const name = cleanTeam(team)
  if (!name) return null
  const id = logos?.[name]
  return { name, initials: teamInitials(name), src: id ? `${import.meta.env.BASE_URL}team-logos/${id}.png` : null }
}
