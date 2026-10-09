import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createSignalTrack,
  createAnnotationTrack,
  addTrack,
  removeTrack,
  setVisibility,
  reorderTrack,
  setColor,
  visibleTracksInOrder,
  checkGenomeLengthMismatch,
} from '../src/tracks.js'

test('createSignalTrack requires files.single for unstranded', () => {
  assert.throws(() => createSignalTrack({ name: 'x', files: {} }), /files.single/)
  const t = createSignalTrack({ name: 'x', files: { single: 'a.bw' } })
  assert.equal(t.strand, 'unstranded')
  assert.equal(t.visible, true)
})

test('createSignalTrack requires files.plus and files.minus for paired', () => {
  assert.throws(
    () => createSignalTrack({ name: 'x', strand: 'paired', files: { plus: 'a.bw' } }),
    /files.plus and files.minus/
  )
  const t = createSignalTrack({
    name: 'x',
    strand: 'paired',
    files: { plus: 'a.bw', minus: 'b.bw' },
  })
  assert.equal(t.strand, 'paired')
})

test('addTrack assigns increasing order, removeTrack compacts order', () => {
  let list = []
  const t1 = createSignalTrack({ name: 'a', files: { single: 'a.bw' } })
  const t2 = createSignalTrack({ name: 'b', files: { single: 'b.bw' } })
  list = addTrack(list, t1)
  list = addTrack(list, t2)
  assert.deepEqual(list.map((t) => t.order), [0, 1])
  list = removeTrack(list, t1.id)
  assert.equal(list.length, 1)
  assert.equal(list[0].order, 0)
})

test('setVisibility and visibleTracksInOrder filter+sort', () => {
  const t1 = createSignalTrack({ name: 'a', files: { single: 'a.bw' } })
  const t2 = createSignalTrack({ name: 'b', files: { single: 'b.bw' } })
  let list = addTrack(addTrack([], t1), t2)
  list = setVisibility(list, t1.id, false)
  const visible = visibleTracksInOrder(list)
  assert.equal(visible.length, 1)
  assert.equal(visible[0].id, t2.id)
})

test('reorderTrack moves a track and reassigns order', () => {
  const t1 = createSignalTrack({ name: 'a', files: { single: 'a.bw' } })
  const t2 = createSignalTrack({ name: 'b', files: { single: 'b.bw' } })
  const t3 = createSignalTrack({ name: 'c', files: { single: 'c.bw' } })
  let list = addTrack(addTrack(addTrack([], t1), t2), t3)
  list = reorderTrack(list, t3.id, 0)
  assert.deepEqual(list.map((t) => t.id), [t3.id, t1.id, t2.id])
  assert.deepEqual(list.map((t) => t.order), [0, 1, 2])
})

test('setColor updates only the targeted track', () => {
  const t1 = createSignalTrack({ name: 'a', files: { single: 'a.bw' } })
  let list = addTrack([], t1)
  list = setColor(list, t1.id, '#ff0000')
  assert.equal(list[0].color, '#ff0000')
})

test('checkGenomeLengthMismatch flags a differing recorded length', () => {
  const t = createSignalTrack({ name: 'a', files: { single: 'a.bw' }, genomeLength: 16569 })
  assert.equal(checkGenomeLengthMismatch(t, 16569), false)
  assert.equal(checkGenomeLengthMismatch(t, 16000), true)
})

test('createAnnotationTrack stores features', () => {
  const t = createAnnotationTrack({ name: 'genes', features: [{ name: 'ND1', start: 0, end: 10, strand: '+' }] })
  assert.equal(t.type, 'annotation')
  assert.equal(t.features.length, 1)
})

import { pairBigWigFiles, packLanes } from '../src/tracks.js'

test('pairBigWigFiles merges plus/minus files and leaves the rest single', () => {
  const f = (name) => ({ name })
  const out = pairBigWigFiles([f('s1.plus.bw'), f('s1.minus.bw'), f('s2_fwd.bw'), f('lone.bw'), f('s3_rev.bw')])
  assert.equal(out.length, 4)
  assert.deepEqual(out.filter((e) => e.plus).map((e) => e.name), ['s1'])
  assert.deepEqual(out.filter((e) => e.single).map((e) => e.name).sort(), ['lone', 's2_fwd', 's3_rev'])
})

test('packLanes puts overlapping features in separate lanes', () => {
  const { lanes, laneCount } = packLanes([
    { start: 0, end: 100 },
    { start: 50, end: 150 },
    { start: 100, end: 200 },
  ])
  assert.equal(laneCount, 2)
  assert.deepEqual(lanes, [0, 1, 0])
})
