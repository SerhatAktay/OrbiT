// src/draw.js
// Builds the SVG scene from already-fetched data. Everything is styled with
// inline attributes so the serialized SVG exports identically.
import {
  TAU,
  computeTrackBands,
  computeScale,
  signalPath,
  zeroLineRadius,
  arcPath,
  visibleSegments,
  rulerTicks,
  niceStep,
  formatBp,
  relAngle,
  polar,
} from './render.js'
import { ringOwners } from './tracks.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
const FONT = 'system-ui, -apple-system, Segoe UI, sans-serif'

export function el(tag, attrs, parent) {
  const node = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  if (parent) parent.appendChild(node)
  return node
}

export function text(parent, str, x, y, attrs = {}) {
  const t = el('text', { x, y, 'font-family': FONT, ...attrs }, parent)
  t.textContent = str
  return t
}

// Rotation that keeps tangent text upright.
function uprightRotation(angle) {
  let rot = (angle * 180) / Math.PI + 90
  rot = ((rot % 360) + 360) % 360
  return rot > 90 && rot < 270 ? rot + 180 : rot
}

export function onColor(hex) {
  const n = parseInt(hex.slice(1), 16)
  const lum = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)
  return lum > 150 ? '#111' : '#fff'
}

export const fmtVal = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(1) : v.toPrecision(2))

// data: Map(trackId -> { bins } | { plusBins, minusBins }) for signal tracks.
// Returns the scene geometry used for hit-testing.
export function drawScene(root, { width, height, genome, tracks, data, theme, ySettings }) {
  root.replaceChildren()
  const cx = width / 2
  const cy = height / 2
  const { length, view } = genome
  const { start: vs, span } = view
  const full = span >= length

  el('rect', { x: 0, y: 0, width, height, fill: theme.bg }, root)
  const g = el('g', { transform: `translate(${cx},${cy})` }, root)

  const rulerR = Math.min(cx, cy) - 40
  const maxRadius = rulerR - 8
  const minRadius = Math.max(28, rulerR * 0.2)
  const scene = { cx, cy, rulerR, minRadius, maxRadius, bands: [] }
  if (rulerR < 60) return scene

  // Ruler.
  el('circle', { r: rulerR, fill: 'none', stroke: theme.fg, 'stroke-width': 1 }, g)
  const step = niceStep(span)
  for (const t of rulerTicks(length, vs, span)) {
    const a = relAngle(t.rel, span)
    const len = t.major ? 8 : 4
    const [x1, y1] = polar(rulerR, a)
    const [x2, y2] = polar(rulerR + len, a)
    el('line', { x1, y1, x2, y2, stroke: theme.fg, 'stroke-width': t.major ? 1 : 0.6 }, g)
    if (t.major) {
      const [lx, ly] = polar(rulerR + 18, a)
      const label = step >= 1000 ? formatBp(t.bp) : t.bp.toLocaleString('en-US')
      text(g, label, lx, ly, {
        'font-size': 10,
        fill: theme.muted,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        transform: `rotate(${uprightRotation(a)} ${lx} ${ly})`,
      })
    }
  }
  if (!full) {
    // Mark the seam where the window wraps onto itself.
    const [x1, y1] = polar(minRadius - 4, -Math.PI / 2)
    const [x2, y2] = polar(rulerR, -Math.PI / 2)
    el('line', { x1, y1, x2, y2, stroke: theme.accent, 'stroke-width': 1, 'stroke-dasharray': '3 3' }, g)
  }

  // Origin (bp 1) marker whenever the window covers it, so rotation never hides where the genome starts.
  const originRel = (length - vs) % length
  if (originRel < span) {
    const a = relAngle(originRel, span)
    const [x1, y1] = polar(rulerR - 6, a)
    const [x2, y2] = polar(rulerR + 12, a)
    el('line', { x1, y1, x2, y2, stroke: theme.accent, 'stroke-width': 2.5 }, g)
    const [lx, ly] = polar(rulerR + 32, a)
    text(g, 'origin', lx, ly, { 'font-size': 10, 'font-weight': 600, fill: theme.accent, 'text-anchor': 'middle', 'dominant-baseline': 'central', transform: `rotate(${uprightRotation(a)} ${lx} ${ly})` })
  }

  // Minimap: whole genome with the current window as an arc. Only when zoomed and clear of the main ring.
  if (!full) {
    const R = 28
    const mx = 16 + R
    const my = 16 + R
    if (Math.hypot(cx - mx, cy - my) > rulerR + 40 + R) {
      scene.minimap = { x: mx, y: my, r: R }
      const at = (bp) => {
        const a = (bp / length) * TAU - Math.PI / 2
        return [mx - cx + R * Math.cos(a), my - cy + R * Math.sin(a)]
      }
      const [ax, ay] = at(vs)
      const [bx, by] = at(vs + span)
      el('circle', { cx: mx - cx, cy: my - cy, r: R, fill: theme.bg, stroke: theme.muted, 'stroke-width': 1 }, g)
      el('path', { d: `M${ax},${ay} A${R},${R} 0 ${span / length > 0.5 ? 1 : 0} 1 ${bx},${by}`, fill: 'none', stroke: theme.accent, 'stroke-width': 4 }, g)
      const [ox, oy] = at(0)
      el('circle', { cx: ox, cy: oy, r: 2, fill: theme.fg }, g)
      text(g, genome.name, mx - cx, my - cy + 3, { 'font-size': 9, fill: theme.muted, 'text-anchor': 'middle' }).setAttribute('pointer-events', 'none')
    }
  }

  // Centre read-out.
  const range = full
    ? `${length.toLocaleString('en-US')} bp`
    : `${Math.round(vs + 1).toLocaleString('en-US')}–${Math.round(((vs + span - 1) % length) + 1).toLocaleString('en-US')}`
  text(g, genome.name, 0, -8, { 'font-size': 15, 'font-weight': 600, fill: theme.fg, 'text-anchor': 'middle' })
  text(g, range, 0, 10, { 'font-size': 11, fill: theme.muted, 'text-anchor': 'middle' })
  if (!full) text(g, `${Math.round(span).toLocaleString('en-US')} bp window`, 0, 24, { 'font-size': 10, fill: theme.muted, 'text-anchor': 'middle' })
  text(g, '↻ bp increases clockwise', 0, full ? 24 : 38, { 'font-size': 9, fill: theme.muted, 'text-anchor': 'middle' })

  const owners = ringOwners(tracks)
  scene.bands = computeTrackBands(owners, { minRadius: minRadius + 34, maxRadius, bandGap: 4 })
  const fs = 10
  const ys = ySettings || {}

  const { bandMax, sharedMax } = prepareSignalBands(scene.bands, tracks, data)
  scene.bandMax = bandMax

  for (const band of scene.bands) {
    const { track, innerRadius, outerRadius } = band
    const bandG = el('g', {}, g)
    el('circle', { r: (innerRadius + outerRadius) / 2, fill: 'none', stroke: theme.grid, 'stroke-width': outerRadius - innerRadius }, bandG)

    let caption = track.name
    if (track.type === 'annotation') {
      drawAnnotation(bandG, band, genome, theme)
    } else if (band.rawScale) {
      const scale = resolveScale(band, ys, sharedMax, bandMax)
      band.scale = scale
      const zero = zeroLineRadius(band, scale)
      if (scale.lo < 0) el('circle', { r: zero, fill: 'none', stroke: theme.muted, 'stroke-width': 0.5, 'stroke-dasharray': '2 2' }, bandG)
      const multi = band.members.length > 1
      for (const [bins, color] of band.layers) {
        el('path', { d: signalPath(bins, band, vs, span, scale), fill: color, 'fill-opacity': multi ? 0.5 : 0.75, stroke: color, 'stroke-width': 0.5, 'stroke-linejoin': 'round' }, bandG)
      }
      caption = band.members.map((m) => m.track.name).join(' + ') || caption
      caption = `${caption.length > 22 ? `${caption.slice(0, 21)}…` : caption}  ${fmtVal(scale.lo)}…${fmtVal(scale.hi)}`
    }
    const t = text(g, caption, -6, -outerRadius + fs + 1, { 'font-size': fs, fill: theme.fg, 'text-anchor': 'end', stroke: theme.bg, 'stroke-width': 3, 'paint-order': 'stroke' })
    t.setAttribute('pointer-events', 'none')
  }
  return scene
}

// Pass 1 (shared with the linear view): members, layers and own value range per
// band (overlay = shared band). Returns per-band max and the max over all bands.
export function prepareSignalBands(bands, tracks, data) {
  for (const band of bands) {
    const owner = band.track
    if (owner.type !== 'signal') continue
    const members = owner.group ? tracks.filter((m) => m.type === 'signal' && m.group === owner.group) : [owner]
    band.members = members.filter((m) => data.get(m.id)).map((m) => ({ track: m, data: data.get(m.id) }))
    band.mirrored = band.members.some((m) => m.track.strand === 'paired')
    band.layers = band.members.flatMap(({ track: m, data: d }) =>
      m.strand === 'paired'
        ? [
            [d.plusBins.map((b) => ({ ...b, value: Math.abs(b.value) })), m.color],
            [d.minusBins.map((b) => ({ ...b, value: -Math.abs(b.value) })), m.colorMinus],
          ]
        : [[d.bins, m.color]]
    )
    band.data = band.members[0]?.data
    band.rawScale = computeScale(band.layers.flatMap(([bins]) => bins.map((b) => b.value)), owner.yScale, band.mirrored)
  }
  const bandMax = new Map(bands.filter((b) => b.rawScale).map((b) => [b.track.id, Math.max(Math.abs(b.rawScale.lo), Math.abs(b.rawScale.hi))]))
  return { bandMax, sharedMax: Math.max(0, ...bandMax.values()) }
}

// Scale: fixed range wins; else shared max, else locked max, else own auto.
export function resolveScale(band, ys, sharedMax, bandMax) {
  let { lo, hi } = band.rawScale
  if (band.track.yScale.mode !== 'fixed') {
    const m = ys.shared ? sharedMax : ys.locked?.get(band.track.id) ?? bandMax.get(band.track.id)
    const f = ys.factor || 1
    lo = lo < 0 || band.mirrored ? -m / f : 0
    hi = m / f
    if (hi - lo < 1e-9) hi = lo + 1e-9
  }
  return { lo, hi }
}

function drawAnnotation(parent, band, genome, theme) {
  const { track, innerRadius, outerRadius } = band
  const { length, view } = genome
  const { start: vs, span } = view
  const laneH = (outerRadius - innerRadius) / track.laneCount
  band.hits = []
  for (const f of track.features) {
    const lane = f.lane ?? 0
    const inner = innerRadius + lane * laneH + 0.5
    const outer = innerRadius + (lane + 1) * laneH - 0.5
    const mid = (inner + outer) / 2
    for (const seg of visibleSegments(f, length, vs, span)) {
      // Arrow tip only when the tip end is really the feature end.
      const strand = f.strand === '+' && !seg.clippedEnd ? '+' : f.strand === '-' && !seg.clippedStart ? '-' : null
      const d = arcPath(seg.rel0, seg.rel1, span, inner, outer, strand)
      el('path', { d, fill: track.color, stroke: theme.bg, 'stroke-width': 0.6 }, parent)
      band.hits.push({ feature: f, rel0: seg.rel0, rel1: seg.rel1, inner, outer })

      const fontSize = Math.min(11, (outer - inner) * 0.8)
      const arcPx = ((seg.rel1 - seg.rel0) / span) * TAU * mid
      if (fontSize >= 6.5 && f.name.length * fontSize * 0.58 + 6 <= arcPx) {
        const a = relAngle((seg.rel0 + seg.rel1) / 2, span)
        const [x, y] = polar(mid, a)
        const t = text(parent, f.name, x, y, {
          'font-size': fontSize,
          fill: onColor(track.color),
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
          transform: `rotate(${uprightRotation(a)} ${x} ${y})`,
        })
        t.setAttribute('pointer-events', 'none')
      }
    }
  }
}
