import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeTrackBands,
  computeScale,
  signalPath,
  arcPath,
  visibleSegments,
  niceStep,
  rulerTicks,
  formatBp,
} from '../src/render.js'

test('computeTrackBands divides the radius range evenly with a gap', () => {
  const bands = computeTrackBands([{ id: 1 }, { id: 2 }], { minRadius: 100, maxRadius: 200, bandGap: 4 })
  assert.equal(bands[0].innerRadius, 102)
  assert.equal(bands[0].outerRadius, 148)
  assert.equal(bands[1].innerRadius, 152)
  assert.equal(bands[1].outerRadius, 198)
})

test('computeTrackBands honours weights', () => {
  const [a, b] = computeTrackBands([{ weight: 1 }, { weight: 3 }], { minRadius: 0, maxRadius: 100, bandGap: 0 })
  assert.equal(a.outerRadius, 25)
  assert.equal(b.outerRadius - b.innerRadius, 75)
})

test('computeScale: [0,max] for positive data, symmetric for negatives/mirrored, fixed overrides', () => {
  assert.deepEqual(computeScale([1, 4, 2], { mode: 'auto' }, false), { lo: 0, hi: 4 })
  assert.deepEqual(computeScale([-2, 4], { mode: 'auto' }, false), { lo: -4, hi: 4 })
  assert.deepEqual(computeScale([1, 3], { mode: 'auto' }, true), { lo: -3, hi: 3 })
  assert.deepEqual(computeScale([1, 4], { mode: 'fixed', min: 0, max: 10 }, false), { lo: 0, hi: 10 })
})

// Coordinate pairs of a path, ignoring the radii in arc commands.
const pts = (d) => d.replace(/A[\d.]+,[\d.]+ 0 0 [01]/g, '').matchAll(/(-?\d+\.?\d*),(-?\d+\.?\d*)/g)

test('signalPath is empty for no bins and closed otherwise', () => {
  assert.equal(signalPath([], { innerRadius: 10, outerRadius: 20 }, 0, 1000, { lo: 0, hi: 1 }), '')
  const bins = [0, 250, 500, 750].map((s, i) => ({ start: s, end: s + 250, value: i }))
  const d = signalPath(bins, { innerRadius: 10, outerRadius: 20 }, 0, 1000, { lo: 0, hi: 3 })
  assert.match(d, /^M/)
  assert.match(d, /Z$/)
})

test('signalPath stays inside its band (no fill towards the centre)', () => {
  const bins = Array.from({ length: 40 }, (_, i) => ({ start: i * 25, end: i * 25 + 25, value: i % 7 }))
  const d = signalPath(bins, { innerRadius: 50, outerRadius: 80 }, 0, 1000, { lo: 0, hi: 6 })
  for (const m of pts(d)) {
    const r = Math.hypot(Number(m[1]), Number(m[2]))
    assert.ok(r >= 49.99 && r <= 80.01, `radius ${r}`)
  }
})

test('signalPath clamps values to a fixed scale', () => {
  const d = signalPath([{ start: 0, end: 10, value: 1e6 }], { innerRadius: 10, outerRadius: 20 }, 0, 100, { lo: 0, hi: 5 })
  for (const m of pts(d)) assert.ok(Math.hypot(Number(m[1]), Number(m[2])) <= 20.01)
})

test('arcPath produces closed wedges, with and without strand arrows', () => {
  for (const strand of [null, '+', '-']) {
    const d = arcPath(0, 500, 2000, 50, 60, strand)
    assert.match(d, /^M/)
    assert.match(d, /Z$/)
  }
})

test('visibleSegments keeps a feature wrapping the origin as one piece in a rotated full view', () => {
  // D-loop 16023..576 on a 16569 genome, view = full circle starting at 16000
  const segs = visibleSegments({ start: 16023, end: 576 }, 16569, 16000, 16569)
  assert.equal(segs.length, 1)
  assert.equal(Math.round(segs[0].rel1 - segs[0].rel0), 1122)
})

test('visibleSegments clips a feature at the window edge and drops invisible ones', () => {
  const [seg] = visibleSegments({ start: 400, end: 700 }, 1000, 500, 100)
  assert.deepEqual([seg.rel0, seg.rel1, seg.clippedStart, seg.clippedEnd], [0, 100, true, true])
  assert.equal(visibleSegments({ start: 0, end: 50 }, 1000, 500, 100).length, 0)
})

test('niceStep / formatBp / rulerTicks', () => {
  assert.equal(niceStep(16569), 1000)
  assert.equal(niceStep(120), 10)
  assert.equal(formatBp(16569), '16.57 kb')
  assert.equal(formatBp(250), '250')
  const ticks = rulerTicks(16569, 0, 16569)
  assert.ok(ticks.some((t) => t.major && t.bp === 5000))
  assert.ok(ticks.every((t) => t.rel >= 0 && t.rel <= 16569))
})
