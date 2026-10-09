import test from 'node:test'
import assert from 'node:assert/strict'
import { xOf, relAtX, computeLinearBands, signalPathLinear, zeroLineY, featurePath } from '../src/linear.js'

test('xOf and relAtX are inverse and hit the plot edges', () => {
  assert.equal(xOf(0, 1000, 100, 800), 100)
  assert.equal(xOf(1000, 1000, 100, 800), 900)
  assert.equal(relAtX(xOf(250, 1000, 100, 800), 1000, 100, 800), 250)
})

test('computeLinearBands: annotation fixed height, signals share the rest by weight', () => {
  const tracks = [
    { type: 'signal', weight: 1 },
    { type: 'signal', weight: 3 },
    { type: 'annotation', laneCount: 2 },
  ]
  const [a, b, c] = computeLinearBands(tracks, { top: 0, bottom: 500, gap: 10, lane: 20 })
  assert.equal(c.bottom - c.top, 44)
  const free = 500 - 44 - 30
  assert.ok(Math.abs(a.bottom - a.top - free / 4) < 1e-9)
  assert.ok(Math.abs(b.bottom - b.top - (free * 3) / 4) < 1e-9)
  assert.equal(b.top, a.bottom + 10)
})

test('computeLinearBands keeps a minimum signal height when space is short', () => {
  const [a] = computeLinearBands([{ type: 'signal', weight: 1 }], { top: 0, bottom: 20, gap: 6 })
  assert.equal(a.bottom - a.top, 60)
})

test('signalPathLinear mirrors plus and minus about the zero line', () => {
  const band = { top: 0, bottom: 100 }
  const scale = { lo: -10, hi: 10 }
  assert.equal(zeroLineY(band, scale), 50)
  const bins = [{ start: 0, end: 10, value: 10 }]
  assert.match(signalPathLinear(bins, band, 0, 100, scale, 0, 200), /^M0,50L0,0L20,0L20,50Z$/)
  const neg = [{ start: 0, end: 10, value: -10 }]
  assert.match(signalPathLinear(neg, band, 0, 100, scale, 0, 200), /^M0,50L0,100L20,100L20,50Z$/)
})

test('signalPathLinear places bins of a window that wraps the origin continuously', () => {
  // Window starts at bp 900 of a 1000 bp genome; bins run 900..1100 (past the origin).
  const bins = [{ start: 900, end: 1000, value: 1 }, { start: 1000, end: 1100, value: 1 }]
  const d = signalPathLinear(bins, { top: 0, bottom: 10 }, 900, 200, { lo: 0, hi: 1 }, 0, 200)
  assert.ok(d.startsWith('M0,10L0,0L100,0L100,0L200,0'))
})

test('signalPathLinear returns empty path for no bins; values clamp to the scale', () => {
  assert.equal(signalPathLinear([], { top: 0, bottom: 10 }, 0, 10, { lo: 0, hi: 1 }, 0, 10), '')
  const d = signalPathLinear([{ start: 0, end: 2, value: 99 }], { top: 0, bottom: 10 }, 0, 2, { lo: 0, hi: 1 }, 0, 2)
  assert.match(d, /^M0,10L0,0L2,0L2,10Z$/)
})

test('featurePath draws an arrow tip toward the strand direction', () => {
  assert.equal(featurePath(0, 100, 0, 20, null), 'M0,0L100,0L100,20L0,20Z')
  assert.match(featurePath(0, 100, 0, 20, '+'), /100,10/)
  assert.match(featurePath(0, 100, 0, 20, '-'), /0,10Z$/)
})
