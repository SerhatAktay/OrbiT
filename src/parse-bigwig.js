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
  return { chromSizes, handle: bigwig }
}

// Mean signal in `binCount` equal bins over [start, end). `end` may exceed the
// chromosome length: the window then wraps round the origin (circular genome),
// and bin starts stay in window coordinates (start + i*binSize, may be > length).
// Each bigWig interval is spread over the bins it overlaps, weighted by overlap;
// uncovered bases count as 0.
export async function getBinnedValues(bigWigHandle, chromName, start, end, binCount, chromLength = end) {
  const binSize = (end - start) / binCount
  const sums = new Float64Array(binCount)
  const basesPerSpan = Math.max(1, Math.floor(binSize))

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
