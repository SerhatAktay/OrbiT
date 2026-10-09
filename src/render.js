// Pure radial geometry. Positions are "rel" offsets in bp from the view start;
// the view window of `span` bp maps onto the full 360 degrees, 12 o'clock first,
// clockwise.

export const TAU = 2 * Math.PI

export function computeTrackBands(visibleTracks, { minRadius, maxRadius, bandGap = 4 }) {
  const total = visibleTracks.reduce((s, t) => s + (t.weight || 1), 0)
  const unit = (maxRadius - minRadius) / total
  let cursor = minRadius
  return visibleTracks.map((track) => {
    const h = unit * (track.weight || 1)
    const band = { track, innerRadius: cursor + bandGap / 2, outerRadius: cursor + h - bandGap / 2 }
    cursor += h
    return band
  })
}

export function relAngle(rel, span) {
  return (rel / span) * TAU - Math.PI / 2
}

export function polar(radius, angle) {
  return [
    Math.round(radius * Math.cos(angle) * 1e3) / 1e3,
    Math.round(radius * Math.sin(angle) * 1e3) / 1e3,
  ]
}

const pt = (p) => `${p[0]},${p[1]}`

// Value range for a signal track. Auto: [0,max], or symmetric [-max,max] when the
// data has negatives or the track is a mirrored strand pair. Fixed: user min/max.
export function computeScale(values, yScale, mirrored) {
  let lo = 0
  let hi = 0
  let maxAbs = 0
  for (const v of values) {
    if (v < lo) lo = v
    if (v > hi) hi = v
    maxAbs = Math.max(maxAbs, Math.abs(v))
  }
  if (mirrored || lo < 0) {
    lo = -maxAbs
    hi = maxAbs
  }
  if (yScale && yScale.mode === 'fixed') {
    if (Number.isFinite(yScale.min)) lo = yScale.min
    if (Number.isFinite(yScale.max)) hi = yScale.max
  }
  if (hi - lo < 1e-9) hi = lo + 1e-9
  return { lo, hi }
}

// Filled step area between the zero line and the signal: each bin is a flat arc at its
// value from its start to its end angle (no interpolation across bins).
export function signalPath(bins, band, viewStart, span, { lo, hi }) {
  if (bins.length === 0) return ''
  const { innerRadius, outerRadius } = band
  const radiusOf = (v) => innerRadius + ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (outerRadius - innerRadius)
  const base = radiusOf(0)
  const arc = (r, to, sweep) => `A${r},${r} 0 0 ${sweep} ${pt(polar(r, to))}`
  const edges = bins.map((b) => [relAngle(b.start - viewStart, span), relAngle(b.end - viewStart, span)])
  let d = `M${pt(polar(base, edges[0][0]))}`
  bins.forEach((b, i) => {
    const r = radiusOf(b.value)
    d += `L${pt(polar(r, edges[i][0]))}${arc(r, edges[i][1], 1)}`
  })
  for (let i = bins.length - 1; i >= 0; i--) d += `L${pt(polar(base, edges[i][1]))}${arc(base, edges[i][0], 0)}`
  return `${d}Z`
}

export function zeroLineRadius(band, { lo, hi }) {
  const f = (Math.min(hi, Math.max(lo, 0)) - lo) / (hi - lo)
  return band.innerRadius + f * (band.outerRadius - band.innerRadius)
}

// Annular wedge from startRel to endRel, with an optional arrow tip on the end
// (strand '+') or start (strand '-').
export function arcPath(startRel, endRel, span, innerRadius, outerRadius, strand = null) {
  const a0 = relAngle(startRel, span)
  let a1 = relAngle(endRel, span)
  if (a1 - a0 > TAU - 1e-4) a1 = a0 + TAU - 1e-4
  const mid = (innerRadius + outerRadius) / 2
  const head = Math.min((a1 - a0) * 0.5, ((outerRadius - innerRadius) * 0.7) / mid)
  const arc = (r, from, to, sweep) =>
    `A${r},${r} 0 ${Math.abs(to - from) > Math.PI ? 1 : 0} ${sweep} ${pt(polar(r, to))}`
  if (strand === '+' && head > 0) {
    const h = a1 - head
    return [
      `M${pt(polar(outerRadius, a0))}`,
      arc(outerRadius, a0, h, 1),
      `L${pt(polar(mid, a1))}`,
      `L${pt(polar(innerRadius, h))}`,
      arc(innerRadius, h, a0, 0),
      'Z',
    ].join(' ')
  }
  if (strand === '-' && head > 0) {
    const h = a0 + head
    return [
      `M${pt(polar(mid, a0))}`,
      `L${pt(polar(outerRadius, h))}`,
      arc(outerRadius, h, a1, 1),
      `L${pt(polar(innerRadius, a1))}`,
      arc(innerRadius, a1, h, 0),
      'Z',
    ].join(' ')
  }
  return [
    `M${pt(polar(outerRadius, a0))}`,
    arc(outerRadius, a0, a1, 1),
    `L${pt(polar(innerRadius, a1))}`,
    arc(innerRadius, a1, a0, 0),
    'Z',
  ].join(' ')
}

// Clip a feature to the view. Returns 0..2 visible segments in rel coords, each
// { rel0, rel1, clippedStart, clippedEnd } (clipped* = cut by the window edge).
export function visibleSegments(feature, genomeLength, viewStart, span) {
  const len = feature.end >= feature.start ? feature.end - feature.start : feature.end + genomeLength - feature.start
  const rel = (((feature.start - viewStart) % genomeLength) + genomeLength) % genomeLength
  const out = []
  for (const r of [rel, rel - genomeLength]) {
    const a = Math.max(0, r)
    const b = Math.min(span, r + len)
    if (b > a) out.push({ rel0: a, rel1: b, clippedStart: r < 0, clippedEnd: r + len > span })
  }
  return out
}

// 1, 2, 5 x 10^k step giving roughly `target` ticks over `span`.
export function niceStep(span, target = 12) {
  const raw = span / target
  const pow = 10 ** Math.floor(Math.log10(raw))
  const f = raw / pow
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * pow
}

export function formatBp(bp) {
  const a = Math.abs(bp)
  if (a >= 1e6) return `${+(bp / 1e6).toFixed(2)} Mb`
  if (a >= 1e3) return `${+(bp / 1e3).toFixed(2)} kb`
  return `${Math.round(bp)}`
}

// Ruler ticks across the view: [{ rel, bp, major }].
export function rulerTicks(genomeLength, viewStart, span) {
  const step = niceStep(span)
  const minor = step / 5
  const ticks = []
  const first = Math.ceil(viewStart / minor - 1e-9)
  for (let k = first; k * minor <= viewStart + span + 1e-9; k++) {
    const pos = k * minor
    const bp = ((Math.round(pos) % genomeLength) + genomeLength) % genomeLength
    ticks.push({ rel: pos - viewStart, bp, major: k % 5 === 0 })
  }
  return ticks
}
