// src/session.js — save/restore view and per-track settings as JSON.
// Data files are not embedded (browsers can't reopen local paths); tracks are
// matched by name + type when their files are loaded again.
import { setView } from './genome.js'

const KEYS = ['color', 'colorMinus', 'visible', 'weight', 'yScale', 'binCount', 'order', 'smooth', 'sharpen', 'group']

export function captureSession(genome, trackList, mode) {
  return {
    version: 1,
    ...(mode ? { mode } : {}),
    genome: genome ? { name: genome.name, view: genome.view } : null,
    tracks: trackList.map((t) => ({
      name: t.name,
      type: t.type,
      strand: t.strand,
      ...Object.fromEntries(KEYS.filter((k) => k in t).map((k) => [k, t[k]])),
    })),
  }
}

export function parseSession(text) {
  const s = JSON.parse(text)
  if (!s || s.version !== 1 || !Array.isArray(s.tracks)) throw new Error('not an OrbiT session file')
  return s
}

// Apply saved settings to matching tracks; unmatched tracks keep theirs and
// sort after the matched ones. Returns the new track list.
export function applySessionTracks(session, trackList) {
  const saved = new Map(session.tracks.map((s) => [`${s.type}:${s.name}`, s]))
  const merged = trackList.map((t) => {
    const s = saved.get(`${t.type}:${t.name}`)
    if (!s) return { ...t, order: 1e6 + t.order }
    const patch = Object.fromEntries(KEYS.filter((k) => k in s && k in t).map((k) => [k, s[k]]))
    return { ...t, ...patch }
  })
  return merged.sort((a, b) => a.order - b.order).map((t, i) => ({ ...t, order: i }))
}

export function applySessionView(session, genome) {
  if (!genome || !session.genome || session.genome.name !== genome.name) return genome
  return setView(genome, session.genome.view.start, session.genome.view.span)
}
