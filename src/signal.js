// src/signal.js — smoothing / sharpening of binned signal, ported from
// ProBrow backend/app/signal.py (transform_signal). Pure functions on arrays.
// `circular` wraps the edges round the origin (full-genome view); otherwise
// the edges are zero-padded, like numpy's convolve(mode="same").

const oddWindow = (w) => {
  const n = Math.round(w)
  return n % 2 === 0 ? n + 1 : n
}

export function gaussianSmooth(x, window, circular = false) {
  if (window <= 1) return Float32Array.from(x)
  const w = oddWindow(window)
  const sigma = Math.max(1e-6, w / 6)
  const half = (w - 1) / 2
  const kernel = new Float32Array(w)
  let sum = 0
  for (let i = 0; i < w; i++) {
    kernel[i] = Math.exp(-0.5 * ((i - half) / sigma) ** 2)
    sum += kernel[i]
  }
  const n = x.length
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let acc = 0
    for (let k = 0; k < w; k++) {
      let j = i + k - half
      if (circular) j = ((j % n) + n) % n
      else if (j < 0 || j >= n) continue
      acc += x[j] * kernel[k]
    }
    out[i] = acc / sum
  }
  return out
}

// Centered sliding-window max, clipped at the ends (or wrapped when circular).
export function slidingMax(x, window, circular = false) {
  const n = x.length
  const half = (oddWindow(Math.max(1, window)) - 1) / 2
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let m = -Infinity
    for (let k = -half; k <= half; k++) {
      let j = i + k
      if (circular) j = ((j % n) + n) % n
      else if (j < 0 || j >= n) continue
      if (x[j] > m) m = x[j]
    }
    out[i] = m
  }
  return out
}

// Rescale smoothed `s` so its local maxima match those of `x` (gain clipped 0..5).
export function peakPreserve(x, s, window, circular = false) {
  if (window <= 1) return s
  const mx = slidingMax(x, window, circular)
  const ms = slidingMax(s, window, circular)
  return s.map((v, i) => v * Math.min(5, Math.max(0, mx[i] / (ms[i] + 1e-8))))
}

// smooth: window in bins (<=1 off). sharpen: unsharp strength (0 off).
// plain: kbro-style smoothing, a mass-preserving blur (peaks get lower and wider, no peak restore).
export function transformSignal(values, { smooth = 0, sharpen = 0, circular = false, plain = false } = {}) {
  const x = Float32Array.from(values, (v) => (Number.isFinite(v) ? v : 0))
  if (smooth <= 1 && sharpen <= 0) return x
  const smoothed = smooth > 1
  // Base trace: peak-preserving smoothing (or the raw signal when smoothing is off).
  const gs = smoothed ? gaussianSmooth(x, smooth, circular) : x
  const base = smoothed && !plain ? peakPreserve(x, gs, smooth, circular) : gs
  if (sharpen <= 0) return base
  // Sharpen adds the high-frequency detail (x - local mean) back onto the base, so 0 is
  // the smoothed trace and the effect grows smoothly. ProBrow instead unsharp-masks the
  // raw signal, which discards the smoothing as soon as sharpen > 0.
  const s = gaussianSmooth(x, smoothed ? smooth : 9, circular)
  return base.map((b, i) => Math.max(0, b + (x[i] - s[i]) * sharpen))
}

// Slider value 0..100 -> unsharp strength 0..4 (ProBrow's mapping).
export const sharpenStrength = (ui) => Math.round(Math.min(1, Math.max(0, ui / 100)) * 400) / 100

// Smoothing window in bins for a bp width; 0 when off.
export const smoothBins = (bp, binSize) => (bp > 0 ? Math.max(0, Math.round(bp / binSize)) : 0)

// Apply to a bin array ([{start,end,value}]); `abs` mirrors ProBrow's minus-strand handling.
export function transformBins(bins, { smoothBp = 0, sharpenUi = 0, circular = false, abs = false, plain = false } = {}) {
  if (!bins.length || (smoothBp <= 0 && sharpenUi <= 0)) return bins
  const binSize = bins[0].end - bins[0].start
  const vals = bins.map((b) => (abs ? Math.abs(b.value) : b.value))
  const out = transformSignal(vals, { smooth: smoothBins(smoothBp, binSize), sharpen: sharpenStrength(sharpenUi), circular, plain })
  return bins.map((b, i) => ({ ...b, value: out[i] }))
}
