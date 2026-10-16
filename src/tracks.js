let nextId = 1

export const PALETTE = ['#1f77b4', '#d62728', '#2ca02c', '#ff7f0e', '#9467bd', '#17becf', '#8c564b', '#e377c2']

export function createSignalTrack({
  name,
  files,
  strand = 'unstranded',
  color = PALETTE[0],
  colorMinus = PALETTE[1],
  binCount = 0, // 0 = auto (matches ring resolution)
  genomeLength = null,
}) {
  if (strand === 'paired' && !(files && files.plus && files.minus)) {
    throw new Error('Paired track requires files.plus and files.minus')
  }
  if (strand !== 'paired' && !(files && files.single)) {
    throw new Error('Unstranded track requires files.single')
  }
  return {
    id: nextId++,
    name,
    type: 'signal',
    strand,
    files,
    color,
    colorMinus,
    visible: true,
    order: 0,
    weight: strand === 'paired' ? 1.6 : 1.2,
    yScale: { mode: 'auto', min: null, max: null },
    binCount,
    smooth: 0, // bars: level x 10; area: bp. 0 = off
    sharpen: 0, // 0..100 (area style)
    group: null, // tracks sharing a group id draw on one ring
    genomeLength,
  }
}

// Greedy interval packing so overlapping features get separate lanes.
// Features wrapping the origin (end < start) block their lane to the end.
export function packLanes(features) {
  const laneEnds = []
  const order = features.map((f, i) => i).sort((a, b) => features[a].start - features[b].start)
  const lanes = new Array(features.length).fill(0)
  for (const i of order) {
    const f = features[i]
    const lane = laneEnds.findIndex((end) => end <= f.start)
    const use = lane === -1 ? laneEnds.length : lane
    laneEnds[use] = f.end >= f.start ? f.end : Infinity
    lanes[i] = use
  }
  return { lanes, laneCount: Math.max(1, laneEnds.length) }
}

export function createAnnotationTrack({ name, features, color = '#888888' }) {
  const { lanes, laneCount } = packLanes(features)
  return {
    id: nextId++,
    name,
    type: 'annotation',
    strand: 'unstranded',
    features: features.map((f, i) => ({ ...f, lane: lanes[i] })),
    laneCount,
    color,
    visible: true,
    order: 0,
    weight: 0.6,
  }
}

export function addTrack(trackList, track) {
  return [...trackList, { ...track, order: trackList.length }]
}

export function removeTrack(trackList, id) {
  return [...trackList]
    .sort((a, b) => a.order - b.order)
    .filter((t) => t.id !== id)
    .map((t, i) => ({ ...t, order: i }))
}

export function setVisibility(trackList, id, visible) {
  return trackList.map((t) => (t.id === id ? { ...t, visible } : t))
}

export function reorderTrack(trackList, id, newOrder) {
  const sorted = [...trackList].sort((a, b) => a.order - b.order)
  const idx = sorted.findIndex((t) => t.id === id)
  if (idx === -1) return trackList
  const [moved] = sorted.splice(idx, 1)
  sorted.splice(Math.max(0, Math.min(newOrder, sorted.length)), 0, moved)
  return sorted.map((t, i) => ({ ...t, order: i }))
}

export function setColor(trackList, id, color) {
  return trackList.map((t) => (t.id === id ? { ...t, color } : t))
}

export function setYScale(trackList, id, yScale) {
  return trackList.map((t) => (t.id === id ? { ...t, yScale: { ...t.yScale, ...yScale } } : t))
}

export function setBinCount(trackList, id, binCount) {
  return trackList.map((t) => (t.id === id ? { ...t, binCount } : t))
}

export function setTrackProp(trackList, id, patch) {
  return trackList.map((t) => (t.id === id ? { ...t, ...patch } : t))
}

// Put `id` on the same ring as `otherId` (null = back on its own ring).
export function setOverlay(trackList, id, otherId) {
  const other = trackList.find((t) => t.id === otherId)
  if (!other) return trackList.map((t) => (t.id === id ? { ...t, group: null } : t))
  const group = other.group ?? `g${other.id}`
  return trackList.map((t) => (t.id === other.id || t.id === id ? { ...t, group } : t))
}

// First visible member of each group (or ungrouped track) owns the ring.
export function ringOwners(visible) {
  const seen = new Set()
  return visible.filter((t) => {
    if (t.type !== 'signal' || !t.group) return true
    if (seen.has(t.group)) return false
    seen.add(t.group)
    return true
  })
}

export function setWeight(trackList, id, weight) {
  return trackList.map((t) => (t.id === id ? { ...t, weight } : t))
}

export function visibleTracksInOrder(trackList) {
  return trackList.filter((t) => t.visible).sort((a, b) => a.order - b.order)
}

export function checkGenomeLengthMismatch(track, genomeLength) {
  return track.genomeLength != null && track.genomeLength !== genomeLength
}

const STRAND_TOKEN = /(^|[._-])(plus|minus|pos|neg|fwd|rev|forward|reverse|fw|rv)(?=[._-]|$)/i
const PLUS_TOKENS = new Set(['plus', 'pos', 'fwd', 'forward', 'fw'])

// { key, side } from a strand token in the filename, or null.
export function strandInfo(file) {
  const name = file.name.replace(/\.(bw|bigwig)$/i, '')
  const m = name.match(STRAND_TOKEN)
  if (!m) return null
  return { key: name.replace(STRAND_TOKEN, '').replace(/[._-]+$/, ''), side: PLUS_TOKENS.has(m[2].toLowerCase()) ? 'plus' : 'minus' }
}

// Group bigWig files into strand pairs by filename (sample.plus.bw + sample.minus.bw).
// Returns [{ name, single } | { name, plus, minus }]; a lone stranded file stays single.
export function pairBigWigFiles(files) {
  const base = (f) => f.name.replace(/\.(bw|bigwig)$/i, '')
  const groups = new Map()
  const out = []
  for (const file of files) {
    const info = strandInfo(file)
    if (!info) {
      out.push({ name: base(file), single: file })
      continue
    }
    const { key, side } = info
    if (!groups.has(key)) groups.set(key, {})
    groups.get(key)[side] = file
  }
  for (const [key, g] of groups) {
    if (g.plus && g.minus) out.push({ name: key || 'signal', plus: g.plus, minus: g.minus })
    else {
      const file = g.plus || g.minus
      out.push({ name: base(file), single: file })
    }
  }
  return out
}
