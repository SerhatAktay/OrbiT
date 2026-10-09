import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGenome, setView } from '../src/genome.js'
import { createSignalTrack, createAnnotationTrack, addTrack } from '../src/tracks.js'
import { captureSession, parseSession, applySessionTracks, applySessionView } from '../src/session.js'

const build = () => {
  let list = []
  list = addTrack(list, createAnnotationTrack({ name: 'genes', features: [{ start: 0, end: 10 }] }))
  list = addTrack(list, createSignalTrack({ name: 'sig', files: { single: 'sig.bw' } }))
  return list
}

test('session round-trips settings, order and view onto freshly loaded tracks', () => {
  const tracks = build().map((t) => (t.name === 'sig' ? { ...t, color: '#123456', weight: 3, order: 0 } : { ...t, order: 1, visible: false }))
  const genome = setView(createGenome(1000, 'chrM'), 900, 300)
  const session = parseSession(JSON.stringify(captureSession(genome, tracks)))

  const fresh = applySessionTracks(session, build())
  assert.deepEqual(fresh.map((t) => t.name), ['sig', 'genes'])
  assert.equal(fresh[0].color, '#123456')
  assert.equal(fresh[0].weight, 3)
  assert.equal(fresh[1].visible, false)
  assert.deepEqual(applySessionView(session, createGenome(1000, 'chrM')).view, { start: 900, span: 300 })
})

test('unmatched tracks keep their settings and sort last; other genomes keep their view', () => {
  const session = { version: 1, genome: { name: 'chrX', view: { start: 5, span: 100 } }, tracks: [{ name: 'sig', type: 'signal', order: 0, color: '#000000' }] }
  const out = applySessionTracks(session, build())
  assert.deepEqual(out.map((t) => t.name), ['sig', 'genes'])
  assert.deepEqual(applySessionView(session, createGenome(1000, 'chrM')).view, { start: 0, span: 1000 })
})

test('parseSession rejects other JSON', () => {
  assert.throws(() => parseSession('{"a":1}'), /not an OrbiT session/)
})
