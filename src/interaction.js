// src/interaction.js
import { zoomAt, panBy } from './genome.js'
import { TAU } from './render.js'

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

// `getGenome` returns the *current* genome: this is wired once before any file
// loads, so handlers must read live state instead of closing over a stale value.
// onClick fires for a press-release without drag.
// Linear counterpart: wheel zooms at the cursor, drag pans horizontally.
// `getPlot` returns { x0, w } of the current scene. As above, getGenome returns
// null while this mode is inactive.
export function attachLinearZoomPan(svgEl, getGenome, getPlot, onChange, onClick, discrete = () => false) {
  let lastX = null
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
    event.preventDefault()
    if (discrete()) {
      // kbro: one wheel flick = one 25% step (x0.8 in, x1.25 out) at the cursor; trackpad
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
    if (moved > 4) onChange(panBy(genome, -(dx / getPlot().w) * genome.view.span))
  })

  svgEl.addEventListener('pointerup', (event) => {
    if (lastX !== null && moved <= 4 && onClick) onClick(event)
    lastX = null
  })

  svgEl.addEventListener('dblclick', (event) => {
    const genome = getGenome()
    if (genome && getPlot()) onChange(zoomAt(genome, event.shiftKey ? 2 : 0.5, fracAt(event)))
  })
}

export function attachZoomPan(svgEl, getGenome, onChange, onClick) {
  let last = null // last pointer angle while dragging
  let moved = 0

  svgEl.addEventListener('wheel', (event) => {
    event.preventDefault()
    const genome = getGenome()
    if (!genome) return
    const factor = Math.exp(event.deltaY * 0.0015) // smooth for trackpads and wheels
    onChange(zoomAt(genome, factor, fracOf(svgEl, event)))
  }, { passive: false })

  svgEl.addEventListener('pointerdown', (event) => {
    if (!getGenome()) return
    last = angleOf(svgEl, event)
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
    if (moved > 4) onChange(panBy(genome, -(delta / TAU) * genome.view.span))
  })

  svgEl.addEventListener('pointerup', (event) => {
    if (last !== null && moved <= 4 && onClick) onClick(event)
    last = null
  })

  svgEl.addEventListener('dblclick', (event) => {
    const genome = getGenome()
    if (genome) onChange(zoomAt(genome, event.shiftKey ? 2 : 0.5, fracOf(svgEl, event)))
  })
}
