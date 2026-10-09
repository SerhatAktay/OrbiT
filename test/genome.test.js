// test/genome.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGenome, setView, resetView, isFullView, viewSpan, zoomAt, panBy, zoomToRange, relPos } from '../src/genome.js'

test('createGenome starts at full view', () => {
  const g = createGenome(16569, 'chrM')
  assert.equal(g.length, 16569)
  assert.deepEqual(g.view, { start: 0, span: 16569 })
  assert.equal(isFullView(g), true)
})

test('createGenome rejects non-positive length', () => {
  assert.throws(() => createGenome(0), /positive number/)
  assert.throws(() => createGenome(-5), /positive number/)
})

test('setView wraps start and clamps span', () => {
  const g = createGenome(1000)
  assert.equal(setView(g, -50, 200).view.start, 950)
  assert.equal(setView(g, 1100, 200).view.start, 100)
  assert.equal(setView(g, 0, 5000).view.span, 1000)
  assert.equal(setView(g, 0, 1).view.span, 50)
})

test('resetView restores full circle and viewSpan reports window size', () => {
  const g = setView(createGenome(1000), 100, 300)
  assert.equal(viewSpan(g), 300)
  assert.equal(viewSpan(resetView(g)), 1000)
})

test('zoomAt keeps the anchor bp fixed', () => {
  const g = createGenome(1000)
  const z = zoomAt(g, 0.5, 0.25) // anchor at 250 bp
  assert.equal(z.view.span, 500)
  assert.equal(z.view.start + 0.25 * z.view.span, 250)
})

test('panBy wraps across the origin', () => {
  const g = setView(createGenome(1000), 900, 300)
  assert.equal(panBy(g, 200).view.start, 100)
  assert.equal(panBy(g, -950).view.start, 950)
})

test('zoomToRange handles a feature wrapping the origin', () => {
  const g = createGenome(16569)
  const z = zoomToRange(g, 16023, 576, 0) // D-loop: 1122 bp across the origin
  assert.equal(z.view.span, 1122)
  assert.equal(z.view.start, 16023)
  assert.equal(relPos(z, 100), 646)
})
