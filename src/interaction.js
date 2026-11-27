// src/interaction.js
import { zoomAt, panBy, zoomToRange } from './genome.js'
import { TAU, arcPath } from './render.js'

const angleOf = (svgEl, event) => {
  const r = svgEl.getBoundingClientRect()
  return Math.atan2(event.clientY - r.top - r.height / 2, event.clientX - r.left - r.width / 2)
}

// Fraction (0..1) round the ring from 12 o'clock, clockwise.
export const fracOf = (svgEl, event) => ((((angleOf(svgEl, event) + Math.PI / 2) / TAU) % 1) + 1) % 1

export function radiusOf(svgEl, event) {
  const r = svgEl.getBoundingClientRect()
  return Math.hypot(event.clientX - r.left - r.width / 2, event.clientY - r.top - r.height / 2)
}

const SELECT_TOP = 40 // linear selection starts here, so it covers the ruler as well as the tracks

// The highlight shown while Shift+dragging, drawn in its own SVG layer. Esc cancels.
function selection(layer, onCancel) {
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { layer.replaceChildren(); onCancel() } })
  return {
    show(tag, attrs) {
      const node = layer.firstChild ?? layer.appendChild(document.createElementNS('http://www.w3.org/2000/svg', tag))
      const style = { fill: 'var(--accent)', 'fill-opacity': 0.2, stroke: 'var(--accent)', 'stroke-width': 1 }
      for (const [k, v] of Object.entries({ ...style, ...attrs })) node.setAttribute(k, v)
    },
    clear: () => layer.replaceChildren(),
  }
}

// Zoom to the part of the view between two fractions of it.
const zoomToFracs = (genome, a, b) => zoomToRange(genome, genome.view.start + Math.min(a, b) * genome.view.span, genome.view.start + Math.max(a, b) * genome.view.span, 0)

// `getGenome` returns the *current* genome: this is wired once before any file
// loads, so handlers must read live state instead of closing over a stale value.
// onClick fires for a press-release without drag.
// Linear counterpart: wheel zooms at the cursor, drag pans horizontally.
// `getPlot` returns { x0, w } of the current scene. As above, getGenome returns
// null while this mode is inactive.
export function attachLinearZoomPan(svgEl, getGenome, getPlot, onChange, onClick, discrete = () => false, layer = null) {
  let lastX = null
  let anchor = null // { frac, x } while Shift+dragging a region
  const highlight = layer && selection(layer, () => { if (anchor) { anchor = null; lastX = null } })
  let acc = 0
  let lastStep = 0
  let moved = 0
  const xIn = (event) => event.clientX - svgEl.getBoundingClientRect().left
  const fracAt = (event) => {
    const { x0, w } = getPlot()
    return Math.min(1, Math.max(0, (xIn(event) - x0) / w))
  }

  svgEl.addEventListener('wheel', (event) => {
    const genome = getGenome()
    if (!genome || !getPlot()) return
    // When tracks overflow, the wheel over the track names scrolls the list; over the plot it zooms.
    const box = svgEl.parentElement
    if (xIn(event) < getPlot().x0 && box.scrollHeight > box.clientHeight) return
    event.preventDefault()
    if (discrete()) {
      // One wheel flick = one 25% step (x0.8 in, x1.25 out) at the cursor; trackpad
      // inertia is throttled so zooming stays in clean steps.
      acc += event.deltaY
      if (Math.abs(acc) < 40 || event.timeStamp - lastStep < 90) return
      const out = acc > 0
      acc = 0
      lastStep = event.timeStamp
      onChange(zoomAt(genome, out ? 1.25 : 0.8, fracAt(event)))
      return
    }
    onChange(zoomAt(genome, Math.exp(event.deltaY * 0.0015), fracAt(event)))
  }, { passive: false })

  svgEl.addEventListener('pointerdown', (event) => {
    if (!getGenome() || !getPlot()) return
    lastX = xIn(event)
    anchor = highlight && event.shiftKey && lastX >= getPlot().x0 ? { frac: fracAt(event), x: lastX } : null
    moved = 0
    svgEl.setPointerCapture(event.pointerId)
  })

  svgEl.addEventListener('pointermove', (event) => {
    if (lastX === null) return
    const genome = getGenome()
    if (!genome) return
    const x = xIn(event)
    const dx = x - lastX
    lastX = x
    moved += Math.abs(dx)
    if (anchor) {
      const { x0, w, bottom } = getPlot()
      const [a, b] = [anchor.frac, fracAt(event)].sort((p, q) => p - q)
      const y = svgEl.parentElement.scrollTop + SELECT_TOP
      highlight.show('rect', { x: x0 + a * w, y, width: (b - a) * w, height: Math.max(0, bottom - y) })
      return
    }
    if (moved > 4) onChange(panBy(genome, -(dx / getPlot().w) * genome.view.span))
  })

  svgEl.addEventListener('pointerup', (event) => {
    if (lastX !== null && moved <= 4 && onClick) onClick(event)
    else if (anchor && getGenome() && Math.abs(xIn(event) - anchor.x) > 4) onChange(zoomToFracs(getGenome(), anchor.frac, fracAt(event)))
    if (anchor) highlight.clear()
    anchor = null
    lastX = null
  })

  svgEl.addEventListener('pointercancel', () => { highlight?.clear(); anchor = null; lastX = null })

  svgEl.addEventListener('dblclick', (event) => {
    const genome = getGenome()
    if (genome && getPlot()) onChange(zoomAt(genome, event.shiftKey ? 2 : 0.5, fracAt(event)))
  })
}

export function attachZoomPan(svgEl, getGenome, onChange, onClick, layer = null, getRadii = () => null) {
  let last = null // last pointer angle while dragging
  let sweep = null // { from, turned } (fraction, radians) while Shift+dragging an arc
  const highlight = layer && selection(layer, () => { if (sweep) { sweep = null; last = null } })
  let moved = 0

  svgEl.addEventListener('wheel', (event) => {
    const genome = getGenome()
    if (!genome) return // inactive: leave the wheel to the linear view (or the scrollbar)
    event.preventDefault()
    const factor = Math.exp(event.deltaY * 0.0015) // smooth for trackpads and wheels
    onChange(zoomAt(genome, factor, fracOf(svgEl, event)))
  }, { passive: false })

  svgEl.addEventListener('pointerdown', (event) => {
    if (!getGenome()) return
    last = angleOf(svgEl, event)
    sweep = highlight && event.shiftKey && getRadii() ? { from: fracOf(svgEl, event), turned: 0 } : null
    moved = 0
    svgEl.setPointerCapture(event.pointerId)
  })

  svgEl.addEventListener('pointermove', (event) => {
    if (last === null) return
    const genome = getGenome()
    if (!genome) return
    const a = angleOf(svgEl, event)
    let delta = a - last
    if (delta > Math.PI) delta -= TAU
    if (delta < -Math.PI) delta += TAU
    last = a
    moved += Math.abs(delta) * radiusOf(svgEl, event)
    if (sweep) {
      // Summing the steps lets the arc go either way round and past half a circle.
      sweep.turned = Math.max(-TAU, Math.min(TAU, sweep.turned + delta))
      const start = sweep.from * TAU
      const { inner, outer } = getRadii()
      const box = svgEl.getBoundingClientRect()
      highlight.show('path', {
        d: arcPath(start + Math.min(0, sweep.turned), start + Math.max(0, sweep.turned), TAU, inner, outer),
        transform: `translate(${box.width / 2},${box.height / 2})`,
      })
      return
    }
    if (moved > 4) onChange(panBy(genome, -(delta / TAU) * genome.view.span))
  })

  svgEl.addEventListener('pointerup', (event) => {
    if (last !== null && moved <= 4 && onClick) onClick(event)
    else if (sweep && getGenome() && moved > 4 && sweep.turned) onChange(zoomToFracs(getGenome(), sweep.from, sweep.from + sweep.turned / TAU))
    if (sweep) highlight.clear()
    sweep = null
    last = null
  })

  svgEl.addEventListener('pointercancel', () => { highlight?.clear(); sweep = null; last = null })

  svgEl.addEventListener('dblclick', (event) => {
    const genome = getGenome()
    if (genome) onChange(zoomAt(genome, event.shiftKey ? 2 : 0.5, fracOf(svgEl, event)))
  })
}
