import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSignal, transformBins, sharpenStrength, smoothBins } from '../src/signal.js'

const fx = JSON.parse(readFileSync(new URL('./fixtures/signal_expected.json', import.meta.url)))

test('matches ProBrow signal.py transform_signal', () => {
  for (const c of fx.cases) {
    if (c.smooth > 1 && c.spiky > 0) continue // deliberate deviation, see next test
    const out = transformSignal(fx.x, { smooth: c.smooth, sharpen: c.spiky })
    assert.equal(out.length, c.out.length)
    // ProBrow shifts (not clips) its max window over the last bins; skip that tail.
    out.forEach((v, i) => i < out.length - c.smooth && assert.ok(Math.abs(v - c.out[i]) < 1e-3, `smooth=${c.smooth} spiky=${c.spiky} i=${i}: ${v} vs ${c.out[i]}`))
  }
})

test('with smoothing on, sharpen starts from the smoothed trace and moves smoothly toward the raw one', () => {
  const x = fx.x
  const dist = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0)
  const smoothed = transformSignal(x, { smooth: 9 })
  const outs = [0, 0.2, 1, 4].map((k) => transformSignal(x, { smooth: 9, sharpen: k }))
  assert.deepEqual(Array.from(outs[0]), Array.from(smoothed))
  // 5% (k=0.2) stays near the smoothed trace instead of jumping to the raw one.
  assert.ok(dist(outs[1], smoothed) < 0.25 * dist(x, smoothed))
  // More sharpening is monotonically closer to (or past) the raw signal.
  const d = outs.map((o) => dist(o, x))
  assert.ok(d[0] > d[1] && d[1] > d[2])
})

test('circular smoothing wraps across the origin', () => {
  const x = new Array(20).fill(0)
  x[0] = 10
  const lin = transformSignal(x, { smooth: 5 })
  const circ = transformSignal(x, { smooth: 5, circular: true })
  assert.ok(circ[19] > 0 && lin[19] === 0)
})

test('transformBins is a no-op when off and keeps bin coordinates', () => {
  const bins = [0, 1, 2, 3, 4].map((i) => ({ start: i * 10, end: i * 10 + 10, value: i }))
  assert.equal(transformBins(bins, {}), bins)
  const out = transformBins(bins, { smoothBp: 30, abs: true })
  assert.deepEqual(out.map((b) => b.start), bins.map((b) => b.start))
})

test('unit helpers', () => {
  assert.equal(sharpenStrength(100), 4)
  assert.equal(sharpenStrength(50), 2)
  assert.equal(smoothBins(100, 10), 10)
  assert.equal(smoothBins(0, 10), 0)
})
