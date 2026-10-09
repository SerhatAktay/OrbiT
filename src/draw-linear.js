// src/draw-linear.js — linear (straight) SVG scene from already-fetched data.
// Same inputs and hit-test shape as drawScene: bands carry top/bottom (y) instead of radii.
import { el, text, onColor, fmtVal, prepareSignalBands, resolveScale } from './draw.js'
import { ringOwners } from './tracks.js'
import { rulerTicks, niceStep, formatBp, visibleSegments } from './render.js'
import { xOf, computeLinearBands, signalPathLinear, zeroLineY, featurePath } from './linear.js'

export const LEFT = 150 // gutter for track names
const RIGHT = 20
const RULER_Y = 56
const TOP = 70
const BOTTOM = 16

const clip = (s, n = 17) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export function drawLinear(root, { width, height, genome, tracks, data, theme, ySettings }) {
  root.replaceChildren()
  const { length, view } = genome
  const { start: vs, span } = view
  const full = span >= length
  const x0 = LEFT
  const w = Math.max(50, width - LEFT - RIGHT)
  const scene = { mode: 'linear', plot: { x0, w, top: TOP, bottom: height - BOTTOM }, bands: [] }

  el('rect', { x: 0, y: 0, width, height, fill: theme.bg }, root)
  const g = el('g', {}, root)
  if (height < TOP + BOTTOM + 60 || width < LEFT + 120) return scene

  // Gutter header: where the window is.
  const range = full
    ? `${length.toLocaleString('en-US')} bp`
    : `${Math.round(vs + 1).toLocaleString('en-US')}–${Math.round(((vs + span - 1) % length) + 1).toLocaleString('en-US')}`
  text(g, genome.name, 12, 22, { 'font-size': 15, 'font-weight': 600, fill: theme.fg })
  text(g, range, 12, 40, { 'font-size': 11, fill: theme.muted })

  // Minimap strip: whole genome with the window as a box (zoomed only).
  if (!full) {
    const my = 10
    const mh = 8
    scene.minimap = { x: x0, y: my, w, h: mh }
    el('rect', { x: x0, y: my, width: w, height: mh, fill: theme.bg, stroke: theme.muted, 'stroke-width': 1 }, g)
    const a = (vs / length) * w
    const b = ((vs + span) / length) * w
    const box = (from, to) => el('rect', { x: x0 + from, y: my, width: Math.max(2, to - from), height: mh, fill: theme.accent, 'fill-opacity': 0.6 }, g)
    if (vs + span <= length) box(a, b)
    else { box(a, w); box(0, ((vs + span - length) / length) * w) }
  }

  // Ruler.
  el('line', { x1: x0, y1: RULER_Y, x2: x0 + w, y2: RULER_Y, stroke: theme.fg, 'stroke-width': 1 }, g)
  const step = niceStep(span)
  for (const t of rulerTicks(length, vs, span)) {
    const x = xOf(t.rel, span, x0, w)
    if (x < x0 - 0.5 || x > x0 + w + 0.5) continue
    el('line', { x1: x, y1: RULER_Y, x2: x, y2: RULER_Y - (t.major ? 8 : 4), stroke: theme.fg, 'stroke-width': t.major ? 1 : 0.6 }, g)
    if (t.major) text(g, step >= 1000 ? formatBp(t.bp) : t.bp.toLocaleString('en-US'), x, RULER_Y - 14, { 'font-size': 10, fill: theme.muted, 'text-anchor': 'middle' })
  }

  // Bands.
  const owners = ringOwners(tracks)
  scene.bands = computeLinearBands(owners, { top: TOP, bottom: height - BOTTOM })
  const { bandMax, sharedMax } = prepareSignalBands(scene.bands, tracks, data)
  scene.bandMax = bandMax
  const ys = ySettings || {}

  for (const band of scene.bands) {
    const { track, top, bottom } = band
    const bandG = el('g', {}, g)
    el('rect', { x: x0, y: top, width: w, height: bottom - top, fill: theme.grid }, bandG)
    let names = [track.name]
    let rangeLine = null
    if (track.type === 'annotation') {
      drawLinearAnnotation(bandG, band, genome, theme, x0, w)
    } else if (band.rawScale) {
      const scale = resolveScale(band, ys, sharedMax, bandMax)
      band.scale = scale
      if (scale.lo < 0) el('line', { x1: x0, y1: zeroLineY(band, scale), x2: x0 + w, y2: zeroLineY(band, scale), stroke: theme.muted, 'stroke-width': 0.5, 'stroke-dasharray': '2 2' }, bandG)
      const multi = band.members.length > 1
      for (const [bins, color] of band.layers) {
        el('path', { d: signalPathLinear(bins, band, vs, span, scale, x0, w), fill: color, 'fill-opacity': multi ? 0.5 : 0.75, stroke: color, 'stroke-width': 0.5, 'stroke-linejoin': 'round' }, bandG)
      }
      names = band.members.map((m) => m.track.name)
      rangeLine = `${fmtVal(scale.lo)}…${fmtVal(scale.hi)}`
      const paired = band.members.find((m) => m.track.strand === 'paired')
      if (paired) {
        text(bandG, '+', x0 + 5, top + 12, { 'font-size': 12, 'font-weight': 700, fill: paired.track.color })
        text(bandG, '−', x0 + 5, bottom - 5, { 'font-size': 12, 'font-weight': 700, fill: paired.track.colorMinus })
      }
    }
    names.forEach((n, i) => text(g, clip(n), x0 - 8, top + 12 + i * 13, { 'font-size': 11, fill: theme.fg, 'text-anchor': 'end' }))
    if (rangeLine) text(g, rangeLine, x0 - 8, top + 12 + names.length * 13, { 'font-size': 10, fill: theme.muted, 'text-anchor': 'end' })
  }

  // Origin (bp 1) line across everything, drawn last so it stays visible.
  const originRel = (length - vs) % length
  if (originRel < span) {
    const x = xOf(originRel, span, x0, w)
    el('line', { x1: x, y1: RULER_Y - 20, x2: x, y2: height - BOTTOM, stroke: theme.accent, 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }, g)
    text(g, 'origin', x + 4, RULER_Y - 24, { 'font-size': 10, 'font-weight': 600, fill: theme.accent })
  }
  return scene
}

function drawLinearAnnotation(parent, band, genome, theme, x0, w) {
  const { track } = band
  const { length, view } = genome
  const { start: vs, span } = view
  const laneH = (band.bottom - band.top) / (track.laneCount || 1)
  band.hits = []
  for (const f of track.features) {
    const top = band.top + (f.lane ?? 0) * laneH + 1
    const bottom = top + laneH - 2
    for (const seg of visibleSegments(f, length, vs, span)) {
      const strand = f.strand === '+' && !seg.clippedEnd ? '+' : f.strand === '-' && !seg.clippedStart ? '-' : null
      const xa = xOf(seg.rel0, span, x0, w)
      const xb = xOf(seg.rel1, span, x0, w)
      el('path', { d: featurePath(xa, xb, top, bottom, strand), fill: track.color, stroke: theme.bg, 'stroke-width': 0.6 }, parent)
      band.hits.push({ feature: f, rel0: seg.rel0, rel1: seg.rel1, inner: top, outer: bottom })
      const fontSize = Math.min(11, (bottom - top) * 0.8)
      if (fontSize >= 6.5 && f.name.length * fontSize * 0.58 + 6 <= xb - xa) {
        text(parent, f.name, (xa + xb) / 2, (top + bottom) / 2, { 'font-size': fontSize, fill: onColor(track.color), 'text-anchor': 'middle', 'dominant-baseline': 'central' })
      }
    }
  }
}
