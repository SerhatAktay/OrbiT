import { BigWig } from '../vendor/bbi.bundle.js'

export async function openBigWig(filehandle) {
  const bigwig = new BigWig({ filehandle })
  const header = await bigwig.getHeader()
  // Note: header.refsByName maps name -> numeric refId, not a ref object.
  // Per-chromosome length lives on header.refsByNumber[refId].length.
  const chromSizes = {}
  for (const ref of Object.values(header.refsByNumber)) {
    chromSizes[ref.name] = ref.length
  }
  // One read = the smallest non-zero |score| in the file (RPM-scaled PRO-seq: 1 / mapped reads).
  const ts = header.totalSummary
  const unit = ts && ts.scoreMin > 0 ? ts.scoreMin : ts && ts.scoreMax < 0 ? -ts.scoreMax : null
  return { chromSizes, handle: bigwig, unit }
}

// bedGraph (text: chrom start end value), read whole: fine for small genomes.
// Returns the same shape as openBigWig. Chrom sizes are only the largest end seen.
// ponytail: getFeatures scans linearly; add a sorted index if big genomes ever matter.
export async function openBedGraph(file) {
  let stream = file.stream()
  if (/\.gz$/i.test(file.name)) stream = stream.pipeThrough(new DecompressionStream('gzip'))
  const text = await new Response(stream).text()
  const byChrom = new Map()
  const chromSizes = {}
  let unit = Infinity
  for (const line of text.split('\n')) {
    if (!line || /^(#|track|browser)/.test(line)) continue
    const [chrom, s, e, v] = line.trim().split(/\s+/)
    const start = Number(s), end = Number(e), score = Number(v)
    if (!chrom || !Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(score)) throw new Error(`bad bedGraph line: "${line.slice(0, 60)}"`)
    if (!byChrom.has(chrom)) byChrom.set(chrom, [])
    byChrom.get(chrom).push({ start, end, score })
    chromSizes[chrom] = Math.max(chromSizes[chrom] ?? 0, end)
    if (score !== 0) unit = Math.min(unit, Math.abs(score))
  }
  if (!byChrom.size) throw new Error('no bedGraph data lines found')
  const handle = { getFeatures: async (chrom, from, to) => (byChrom.get(chrom) ?? []).filter((f) => f.end > from && f.start < to) }
  return { chromSizes, handle, unit: Number.isFinite(unit) ? unit : null, approxSizes: true }
}

// Mean signal in `binCount` equal bins over [start, end). `end` may exceed the
// chromosome length: the window then wraps round the origin (circular genome),
// and bin starts stay in window coordinates (start + i*binSize, may be > length).
// Each bigWig interval is spread over the bins it overlaps, weighted by overlap;
// uncovered bases count as 0.
// exact: read the raw intervals instead of a zoom summary level (summaries overstate sparse
// signal such as single PRO-seq reads); only sensible for windows up to a few Mb.
export async function getBinnedValues(bigWigHandle, chromName, start, end, binCount, chromLength = end, exact = false) {
  const binSize = (end - start) / binCount
  const sums = new Float64Array(binCount)
  const basesPerSpan = exact ? 1 : Math.max(1, Math.floor(binSize))

  // [windowStart, windowEnd) pieces in window coords, with the chrom coord offset.
  const pieces = []
  const firstEnd = Math.min(end, chromLength)
  if (firstEnd > start) pieces.push({ from: start, to: firstEnd, shift: 0 })
  if (end > chromLength) {
    const from = Math.max(0, start - chromLength)
    pieces.push({ from, to: end - chromLength, shift: chromLength })
  }

  for (const piece of pieces) {
    const features = await bigWigHandle.getFeatures(chromName, piece.from, piece.to, { basesPerSpan })
    for (const f of features) {
      const s = Math.max(f.start, piece.from) + piece.shift
      const e = Math.min(f.end, piece.to) + piece.shift
      if (e <= s) continue
      const i0 = Math.max(0, Math.floor((s - start) / binSize))
      const i1 = Math.min(binCount - 1, Math.floor((e - start - 1e-9) / binSize))
      for (let i = i0; i <= i1; i++) {
        const lo = Math.max(s, start + i * binSize)
        const hi = Math.min(e, start + (i + 1) * binSize)
        if (hi > lo) sums[i] += f.score * (hi - lo)
      }
    }
  }

  return Array.from(sums, (sum, i) => ({
    start: start + i * binSize,
    end: start + (i + 1) * binSize,
    value: sum / binSize,
  }))
}
