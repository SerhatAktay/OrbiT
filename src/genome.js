// src/genome.js
// A genome is a circle of `length` bp. The view is a window [start, start+span)
// stretched over the full 360 degrees; start wraps modulo length so a window can
// straddle the origin (e.g. the mtDNA D-loop). span === length is the full circle.

export const MIN_SPAN = 50

export const mod = (a, n) => ((a % n) + n) % n

export function createGenome(length, name = 'genome') {
  if (!Number.isFinite(length) || length <= 0) {
    throw new Error(`Genome length must be a positive number, got ${length}`)
  }
  return { length, name, view: { start: 0, span: length } }
}

export function isFullView(genome) {
  return genome.view.span >= genome.length
}

export function setView(genome, start, span) {
  const clampedSpan = Math.min(genome.length, Math.max(Math.min(MIN_SPAN, genome.length), span))
  return { ...genome, view: { start: mod(start, genome.length), span: clampedSpan } }
}

export function resetView(genome) {
  return setView(genome, 0, genome.length)
}

export function viewSpan(genome) {
  return genome.view.span
}

// Zoom by `factor` (<1 zooms in) keeping the bp under `frac` (0..1 round the
// ring from the view start) fixed on screen.
export function zoomAt(genome, factor, frac = 0.5) {
  const { start, span } = genome.view
  const anchor = start + frac * span
  const newSpan = Math.min(genome.length, Math.max(MIN_SPAN, span * factor))
  return setView(genome, anchor - frac * newSpan, newSpan)
}

export function panBy(genome, deltaBp) {
  return setView(genome, genome.view.start + deltaBp, genome.view.span)
}

// Zoom so [start, end) fills the ring with padding; end < start means the
// feature wraps the origin.
export function zoomToRange(genome, start, end, pad = 0.25) {
  const len = end >= start ? end - start : end + genome.length - start
  const span = Math.max(MIN_SPAN, len * (1 + 2 * pad))
  return setView(genome, start - (span - len) / 2, span)
}

// Offset of bp from the view start, in [0, length).
export function relPos(genome, bp) {
  return mod(bp - genome.view.start, genome.length)
}

export function bpAtRel(genome, rel) {
  return mod(genome.view.start + rel, genome.length)
}
