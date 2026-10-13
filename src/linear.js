// src/linear.js — pure geometry for the linear view. A window of `span` bp starting
// at `viewStart` maps onto x0..x0+w; a window crossing the origin is one continuous range.

const r1 = (n) => Math.round(n * 10) / 10

export const xOf = (rel, span, x0, w) => x0 + (rel / span) * w
export const relAtX = (x, span, x0, w) => ((x - x0) / w) * span

// Vertical stack of bands between top and bottom. Annotation bands take a fixed
// height per lane; signal bands share the rest by weight (at least minSignal px each).
export function computeLinearBands(tracks, { top, bottom, gap = 6, lane = 20, minSignal = 60 }) {
  const fixed = tracks.map((t) => (t.type === 'annotation' ? (t.laneCount || 1) * lane + 4 : 0))
  const flex = tracks.filter((_, i) => !fixed[i])
  const flexWeight = flex.reduce((s, t) => s + (t.weight || 1), 0)
  const used = fixed.reduce((a, b) => a + b, 0) + gap * tracks.length
  const free = Math.max(minSignal * flex.length, bottom - top - used)
  let y = top
  return tracks.map((track, i) => {
    const h = fixed[i] || (free * (track.weight || 1)) / flexWeight
    const band = { track, top: y, bottom: y + h }
    y += h + gap
    return band
  })
}

const yOf = (band, { lo, hi }, v) => band.bottom - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (band.bottom - band.top)

export const zeroLineY = (band, scale) => yOf(band, scale, 0)

// Filled step area between the zero line and the signal: each bin is a flat bar from
// its start to its end (no interpolation across bins).
export function signalPathLinear(bins, band, viewStart, span, scale, x0, w) {
  if (!bins.length) return ''
  const base = r1(yOf(band, scale, 0))
  const xa = (b) => r1(xOf(b.start - viewStart, span, x0, w))
  const xb = (b) => r1(xOf(b.end - viewStart, span, x0, w))
  let d = `M${xa(bins[0])},${base}`
  for (const b of bins) d += `L${xa(b)},${r1(yOf(band, scale, b.value))}L${xb(b)},${r1(yOf(band, scale, b.value))}`
  return `${d}L${xb(bins[bins.length - 1])},${base}Z`
}

// kbro look: straight lines between bin centres, so an isolated read is a pointed triangle
// instead of a flat bar.
export function signalPathPointed(bins, band, viewStart, span, scale, x0, w) {
  if (!bins.length) return ''
  const base = r1(yOf(band, scale, 0))
  const cx = (b) => r1(xOf((b.start + b.end) / 2 - viewStart, span, x0, w))
  let d = `M${cx(bins[0])},${base}`
  for (const b of bins) d += `L${cx(b)},${r1(yOf(band, scale, b.value))}`
  return `${d}L${cx(bins[bins.length - 1])},${base}Z`
}

// Feature rectangle from xa to xb, with an arrow tip at the end ('+') or start ('-').
export function featurePath(xa, xb, top, bottom, strand = null) {
  const mid = (top + bottom) / 2
  const head = Math.min((xb - xa) * 0.5, (bottom - top) * 0.5)
  const p = (pts) => `M${pts.map(([x, y]) => `${r1(x)},${r1(y)}`).join('L')}Z`
  if (strand === '+' && head > 0) return p([[xa, top], [xb - head, top], [xb, mid], [xb - head, bottom], [xa, bottom]])
  if (strand === '-' && head > 0) return p([[xa + head, top], [xb, top], [xb, bottom], [xa + head, bottom], [xa, mid]])
  return p([[xa, top], [xb, top], [xb, bottom], [xa, bottom]])
}
