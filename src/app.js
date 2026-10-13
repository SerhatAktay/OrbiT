// src/app.js — state, file loading, render loop, hover/click.
import { BlobFile } from '../vendor/bbi.bundle.js'
import { createGenome, resetView, setView, zoomToRange, bpAtRel, isFullView, zoomAt, panBy } from './genome.js'
import {
  PALETTE,
  createSignalTrack,
  createAnnotationTrack,
  addTrack,
  removeTrack,
  setVisibility,
  reorderTrack,
  setColor,
  setYScale,
  setBinCount,
  setWeight,
  setTrackProp,
  setOverlay,
  visibleTracksInOrder,
  checkGenomeLengthMismatch,
  pairBigWigFiles,
  packLanes,
} from './tracks.js'
import { openBigWig, getBinnedValues } from './parse-bigwig.js'
import { transformBins, kbroBins } from './signal.js'
import { parseAnnotation, parseGenBank, parseGtfLines, normChrom, compareChroms } from './parse-annotation.js'
import { drawScene, fmtVal } from './draw.js'
import { drawLinear, LEFT } from './draw-linear.js'
import { TAU } from './render.js'
import { attachZoomPan, attachLinearZoomPan, fracOf, radiusOf } from './interaction.js'
import { renderTrackPanel } from './ui.js'
import { exportSvg, exportPng, exportHtml } from './export.js'
import { captureSession, parseSession, applySessionTracks, applySessionView } from './session.js'

const $ = (id) => document.getElementById(id)
const canvasArea = $('canvas-area')
const svg = $('canvas')
const viewport = $('viewport')
const overlay = $('overlay')
const panel = $('track-list')
const errorBanner = $('error-banner')
const tooltip = $('tooltip')
const status = $('status')
const chromSelect = $('chrom')

const ANNOTATION_COLORS = ['#8da0cb', '#fc8d62', '#66c2a5', '#e78ac3', '#a6d854', '#ffd92f']

let genome = null
let genomeDerived = false // length guessed from annotations, replaced by the first bigWig
let trackList = []
let scene = null
let lastAutoBins = 600
let mode = 'circular' // or 'linear'
const NT_MAX_SPAN = 4000 // windows up to this many bp show every nucleotide by default
// Global Y controls (ProBrow): shared symmetric max, zoom factor, locked autoscale.
// kbro: unit = one read's score per track, gain = fitted pt-per-density override (a), fit = refit on next draw.
const ySettings = { shared: false, factor: 1, locked: null, kbro: false, unit: new Map(), gain: new Map(), fit: false }
const bigWigHandles = new Map() // trackId -> { chromSizes, single } | { chromSizes, plus, minus }

// ---- helpers ---------------------------------------------------------------

let errorTimer
function showError(message) {
  errorBanner.textContent = message
  errorBanner.style.display = 'block'
  clearTimeout(errorTimer)
  errorTimer = setTimeout(() => { errorBanner.style.display = 'none' }, 6000)
}

function theme() {
  const css = getComputedStyle(document.documentElement)
  const v = (n) => css.getPropertyValue(n).trim()
  return { bg: v('--bg'), fg: v('--fg'), muted: v('--muted'), grid: v('--grid'), accent: v('--accent') }
}

// Real chromosome name in a bigWig that matches the one on screen (chrM == MT == M).
function resolveChrom(chromSizes, name) {
  if (name in chromSizes) return name
  return Object.keys(chromSizes).find((c) => normChrom(c) === normChrom(name)) ?? null
}

const annotationCache = new WeakMap() // track -> { chrom, track }
// Keep features on the displayed chromosome. A single-record file whose name
// matches nothing (GenBank NC_012920 over a chrM bigWig) shows everything; a
// multi-chromosome annotation without this chromosome (hs1 has no chrM) shows nothing.
function annotationForChrom(track) {
  const hit = annotationCache.get(track)
  if (hit && hit.chrom === genome.name) return hit.track
  const mine = track.features.filter((f) => normChrom(f.chrom) === normChrom(genome.name))
  const features = mine.length || new Set(track.features.map((f) => f.chrom)).size > 1 ? mine : track.features
  const { lanes, laneCount } = packLanes(features)
  const out = { ...track, laneCount, features: features.map((f, i) => ({ ...f, lane: lanes[i] })) }
  annotationCache.set(track, { chrom: genome.name, track: out })
  return out
}

function updateChromList() {
  const names = new Set()
  for (const h of bigWigHandles.values()) for (const c of Object.keys(h.chromSizes)) names.add(c)
  // Annotation chromosomes too (hg38 has hundreds of scaffolds: then keep only ones with >= 10 genes).
  const counts = new Map()
  for (const t of trackList) if (t.type === 'annotation') for (const f of t.features) counts.set(f.chrom, (counts.get(f.chrom) ?? 0) + 1)
  const known = new Set([...names].map(normChrom))
  for (const [c, n] of counts) if (!known.has(normChrom(c)) && (counts.size <= 30 || n >= 10)) { names.add(c); known.add(normChrom(c)) }
  chromSelect.replaceChildren(...[...names].sort(compareChroms).map((c) => Object.assign(document.createElement('option'), { value: c, textContent: c })))
  chromSelect.hidden = names.size < 2
  if (genome && names.has(genome.name)) chromSelect.value = genome.name
}

function chromLengthFor(name) {
  for (const h of bigWigHandles.values()) {
    const c = resolveChrom(h.chromSizes, name)
    if (c) return h.chromSizes[c]
  }
  let max = 0
  for (const t of trackList) if (t.type === 'annotation') for (const f of t.features) if (normChrom(f.chrom) === normChrom(name)) max = Math.max(max, f.start, f.end, f.chromLength ?? 0)
  return max
}

// ---- rendering -------------------------------------------------------------

let afterRender = null
let renderGeneration = 0
let pending = false
function requestRender() {
  if (pending) return
  pending = true
  requestAnimationFrame(() => { pending = false; render() })
}

async function fetchSignal(track, handle, autoBins) {
  const { start: viewStart, span: viewSpan } = genome.view
  // Short windows default to one bin per nucleotide on integer bp edges, so no bin
  // blends two neighbouring bases. A manual bin count (track.binCount) wins.
  const nt = !track.binCount && !kbro() && viewSpan <= NT_MAX_SPAN
  const start = nt ? Math.floor(viewStart) : viewStart
  const span = nt ? Math.ceil(viewStart + viewSpan) - start : viewSpan
  const n = nt ? span : Math.max(1, Math.min(track.binCount || autoBins, Math.ceil(span)))
  const load = (reader) => {
    const chrom = resolveChrom(handle.chromSizes, genome.name)
    if (!chrom) return Promise.resolve(Array.from({ length: n }, (_, i) => ({ start: start + (i * span) / n, end: start + ((i + 1) * span) / n, value: 0 })))
    return getBinnedValues(reader, chrom, start, start + span, n, genome.length, kbro() && viewSpan <= 2e6)
  }
  const fx = { smoothBp: track.smooth || 0, sharpenUi: track.sharpen || 0, circular: viewSpan >= genome.length }
  const plotW = Math.max(50, svg.clientWidth - LEFT - 20) // 20 = RIGHT margin in draw-linear
  // kbro: smoothing is a level (the slider value / 10) applied in screen pixels, not bp.
  const tf = kbro()
    ? (bins, abs) => kbroBins(bins, { level: Math.round((track.smooth || 0) / 10), ptPerBin: plotW / bins.length, abs })
    : (bins, abs) => transformBins(bins, { ...fx, abs })
  if (track.strand === 'paired') {
    const [plusBins, minusBins] = await Promise.all([load(handle.plus), load(handle.minus)])
    return { plusBins: tf(plusBins, true), minusBins: tf(minusBins, true) }
  }
  return { bins: tf(await load(handle.single), false) }
}

async function render() {
  if (!genome) return
  const gen = ++renderGeneration
  const width = svg.clientWidth
  const height = svg.clientHeight
  const visible = visibleTracksInOrder(trackList).map((t) => (t.type === 'annotation' ? annotationForChrom(t) : t))
  const autoBins = mode === 'linear'
    ? Math.max(180, Math.min(4000, Math.round((width - LEFT) / (ySettings.kbro ? 1 : 2)))) // kbro: one bin per pt, smoothed in pt
    : Math.max(180, Math.min(2000, Math.round((TAU * (Math.min(width, height) / 2 - 48)) / 2.5)))
  lastAutoBins = autoBins

  // Fetch everything first, then draw in one go: no half-drawn frames, and a
  // newer render (fast wheel zoom) can supersede this one before any DOM write.
  const data = new Map()
  try {
    await Promise.all(
      visible
        .filter((t) => t.type === 'signal' && bigWigHandles.has(t.id))
        .map(async (t) => data.set(t.id, await fetchSignal(t, bigWigHandles.get(t.id), autoBins)))
    )
  } catch (err) {
    showError(`Couldn't read signal: ${err.message}`)
    return
  }
  if (gen !== renderGeneration) return

  scene = (mode === 'linear' ? drawLinear : drawScene)(viewport, { width, height, genome, tracks: visible, data, theme: theme(), ySettings })
  overlay.replaceChildren()
  $('empty').style.display = trackList.length ? 'none' : 'flex'
  const flags = [ySettings.shared && 'shared Y', ySettings.locked && 'Y locked', ySettings.factor !== 1 && `Y ×${ySettings.factor.toFixed(2)}`].filter(Boolean)
  status.textContent = [isFullView(genome) ? '' : `${Math.round(genome.view.span).toLocaleString('en-US')} bp window`, ...flags].filter(Boolean).join(' · ')
  syncGlobals()
  if (afterRender) { const f = afterRender; afterRender = null; f() }
}

// Global bar mirrors the signal tracks (first track's value) and the Y settings.
function syncGlobals() {
  const sig = trackList.filter((t) => t.type === 'signal')
  $('globals').hidden = !sig.length
  if (!sig.length) return
  $('g-smooth').value = sig[0].smooth
  $('g-smooth-v').textContent = sig[0].smooth ? (kbro() ? `level ${Math.round(sig[0].smooth / 10)}` : `${sig[0].smooth} bp`) : 'off'
  $('g-sharpen').value = sig[0].sharpen
  $('g-sharpen-v').textContent = sig[0].sharpen ? `${sig[0].sharpen}%` : 'off'
  $('g-shared').checked = ySettings.shared
  $('g-lock').checked = !!ySettings.locked
}

// ---- file loading ----------------------------------------------------------

function addAnnotationTrack(name, features) {
  const count = trackList.filter((t) => t.type === 'annotation').length
  trackList = addTrack(trackList, createAnnotationTrack({ name, features, color: ANNOTATION_COLORS[count % ANNOTATION_COLORS.length] }))
  if (!genome) {
    const first = [...new Set(features.map((f) => f.chrom))].sort(compareChroms)[0] ?? 'genome'
    const len = features.reduce((m, f) => (normChrom(f.chrom) === normChrom(first) ? Math.max(m, f.start, f.end, f.chromLength ?? 0) : m), 1)
    genome = resetView(createGenome(len, first))
    genomeDerived = true
  }
}

async function openEntry(entry) {
  const signals = entry.single ? { single: entry.single } : { plus: entry.plus, minus: entry.minus }
  const opened = {}
  for (const [key, file] of Object.entries(signals)) opened[key] = await openBigWig(new BlobFile(file))
  const first = Object.values(opened)[0]
  const chromName = Object.keys(first.chromSizes)[0]
  const length = first.chromSizes[chromName]

  if (!genome || genomeDerived) {
    genome = resetView(createGenome(length, chromName))
    genomeDerived = false
  }
  const count = trackList.filter((t) => t.type === 'signal').length
  const paired = !entry.single
  const track = createSignalTrack({
    name: entry.name,
    files: paired ? { plus: entry.plus.name, minus: entry.minus.name } : { single: entry.single.name },
    strand: paired ? 'paired' : 'unstranded',
    color: PALETTE[count % PALETTE.length],
    colorMinus: PALETTE[(count + 1) % PALETTE.length],
    genomeLength: length,
  })
  if (checkGenomeLengthMismatch(track, genome.length)) {
    showError(`"${entry.name}" chromosome length (${length.toLocaleString('en-US')}) differs from the loaded genome (${genome.length.toLocaleString('en-US')}); the tail is clipped or empty.`)
  }
  bigWigHandles.set(track.id, {
    chromSizes: first.chromSizes,
    ...(paired ? { plus: opened.plus.handle, minus: opened.minus.handle } : { single: opened.single.handle }),
  })
  const units = Object.values(opened).map((o) => o.unit).filter(Boolean)
  if (units.length) ySettings.unit.set(track.id, Math.min(...units))
  // PRO-seq default: first stranded pair turns on one shared Y range across samples.
  if (paired && !trackList.some((t) => t.strand === 'paired')) ySettings.shared = true
  trackList = addTrack(trackList, track)
}

async function handleFiles(files) {
  const bigwigs = files.filter((f) => /\.(bw|bigwig)$/i.test(f.name))
  const annotations = files.filter((f) => /\.(bed|gtf|gff3?|gbk?|gbff|genbank)$/i.test(f.name))
  const known = new Set([...bigwigs, ...annotations])
  for (const f of files) if (!known.has(f)) showError(`"${f.name}" isn't a bigWig (.bw) or annotation (.bed/.gtf/.gff) file.`)

  for (const entry of pairBigWigFiles(bigwigs)) {
    try {
      await openEntry(entry)
    } catch (err) {
      showError(`Couldn't read "${entry.name}": ${err.message}`)
    }
  }
  for (const file of annotations) {
    try {
      const features = parseAnnotation(await file.text(), file.name)
      if (!features.length) throw new Error('no features found')
      addAnnotationTrack(file.name, features)
    } catch (err) {
      showError(`Couldn't parse "${file.name}": ${err.message}`)
    }
  }
  updateChromList()
  applyPendingSession()
  rebuildPanel()
  requestRender()
}

// Fetch a GenBank record from NCBI: an accession (NC_012920.1) loads directly;
// anything else is a search and the top RefSeq genomes are offered in a picker.
const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
const ncbi = async (path) => {
  const res = await fetch(`${EUTILS}/${path}`)
  if (!res.ok) throw new Error(`NCBI returned ${res.status}`)
  return res
}

function pickRecord(hits) {
  const dlg = $('pick-dialog')
  dlg.replaceChildren(...hits.map((h) => Object.assign(document.createElement('button'), {
    textContent: `${h.caption} · ${h.title} · ${h.slen.toLocaleString('en-US')} bp`,
    onclick: () => dlg.close(h.caption),
  })), Object.assign(document.createElement('button'), { textContent: 'Cancel', onclick: () => dlg.close('') }))
  return new Promise((resolve) => {
    dlg.onclose = () => resolve(dlg.returnValue)
    dlg.returnValue = ''
    dlg.showModal()
  })
}

// Whole-genome annotations by assembly name (same sources as proBrow).
const ENS = 'https://ftp.ensembl.org/pub'
const GENOMES = {
  hg38: ['Human GRCh38 (Ensembl 113)', `${ENS}/release-113/gtf/homo_sapiens/Homo_sapiens.GRCh38.113.gtf.gz`],
  hg19: ['Human GRCh37 (Ensembl 87)', `${ENS}/grch37/release-87/gtf/homo_sapiens/Homo_sapiens.GRCh37.87.gtf.gz`],
  hs1: ['Human T2T CHM13v2 (UCSC ncbiRefSeq)', 'https://hgdownload.soe.ucsc.edu/goldenPath/hs1/bigZips/genes/hs1.ncbiRefSeq.gtf.gz'],
  mm39: ['Mouse GRCm39 (Ensembl 113)', `${ENS}/release-113/gtf/mus_musculus/Mus_musculus.GRCm39.113.gtf.gz`],
  mm10: ['Mouse GRCm38 (Ensembl 102)', `${ENS}/release-102/gtf/mus_musculus/Mus_musculus.GRCm38.102.gtf.gz`],
  dm6: ['Drosophila BDGP6 (Ensembl 113)', `${ENS}/release-113/gtf/drosophila_melanogaster/Drosophila_melanogaster.BDGP6.46.113.gtf.gz`],
  ce11: ['C. elegans WBcel235 (Ensembl 113)', `${ENS}/release-113/gtf/caenorhabditis_elegans/Caenorhabditis_elegans.WBcel235.113.gtf.gz`],
  danrer11: ['Zebrafish GRCz11 (Ensembl 113)', `${ENS}/release-113/gtf/danio_rerio/Danio_rerio.GRCz11.113.gtf.gz`],
  sacCer3: ['S. cerevisiae R64-1-1 (Ensembl 113)', `${ENS}/release-113/gtf/saccharomyces_cerevisiae/Saccharomyces_cerevisiae.R64-1-1.113.gtf.gz`],
}
GENOMES.saccer3 = GENOMES.sacCer3

// Download (cached in the browser after the first time), gunzip and parse a GTF.
async function loadGenome(label, url) {
  const cache = await globalThis.caches?.open('orbit-annotations').catch(() => null)
  let res = await cache?.match(url)
  if (!res) {
    res = await fetch(url)
    if (!res.ok) throw new Error(`download failed (${res.status})`)
    cache?.put(url, res.clone()).catch(() => {}) // best effort; next load skips the download
  }
  const total = Number(res.headers.get('content-length')) || 0
  let got = 0
  const text = res.body
    .pipeThrough(new TransformStream({ transform(chunk, ctl) { got += chunk.length; ctl.enqueue(chunk) } }))
    .pipeThrough(new DecompressionStream('gzip'))
    .pipeThrough(new TextDecoderStream())
  async function* lines() {
    let tail = ''
    for await (const chunk of text) {
      const parts = (tail + chunk).split('\n')
      tail = parts.pop()
      showError(`Reading ${label}… ${(got / 1e6).toFixed(0)}${total ? ` / ${(total / 1e6).toFixed(0)}` : ''} MB`)
      yield* parts
    }
    if (tail) yield tail
  }
  const features = await parseGtfLines(lines())
  if (!features.length) throw new Error('no genes found')
  return features
}

async function fetchAnnotation() {
  const q = prompt('Assembly (hg38, hg19, hs1, mm39, mm10, dm6, ce11, danRer11, sacCer3), accession (NC_012920.1) or species (Homo sapiens):')?.trim()
  if (!q) return
  try {
    const genomeEntry = GENOMES[q] ?? GENOMES[q.toLowerCase()]
    if (genomeEntry) {
      const [label, url] = genomeEntry
      showError(`Downloading ${label}…`)
      addAnnotationTrack(`${q}.gtf`, await loadGenome(label, url))
      showError(`Loaded ${label}`)
      updateChromList()
      rebuildPanel()
      requestRender()
      return
    }
    let id = q
    if (!/^[A-Z]{1,2}_?\d+(\.\d+)?$/i.test(id)) {
      // Every word must appear in the record title, so "homo sapiens" finds the human genome, not hosts' bacteria.
      const words = q.split(/\s+/).map((w) => `${encodeURIComponent(w)}[title]`).join('+AND+')
      const term = `${words}+AND+srcdb_refseq[prop]+AND+biomol_genomic[prop]+AND+complete+genome[title]`
      const ids = (await (await ncbi(`esearch.fcgi?db=nuccore&retmode=json&retmax=10&term=${term}`)).json()).esearchresult?.idlist ?? []
      if (!ids.length) throw new Error(`no RefSeq genome found for "${q}"`)
      const sum = (await (await ncbi(`esummary.fcgi?db=nuccore&retmode=json&id=${ids.join(',')}`)).json()).result
      id = await pickRecord(ids.map((i) => sum[i]))
      if (!id) return
    }
    const text = await (await ncbi(`efetch.fcgi?db=nuccore&id=${encodeURIComponent(id)}&rettype=gb&retmode=text`)).text()
    const features = parseGenBank(text)
    if (!features.length) throw new Error('no features found')
    addAnnotationTrack(`${features[0].chrom}.gb`, features)
    showError(`Loaded ${text.match(/^DEFINITION\s+(.*)$/m)?.[1] ?? features[0].chrom}`)
    updateChromList()
    rebuildPanel()
    requestRender()
  } catch (err) {
    showError(`Couldn't fetch annotation: ${err.message}`)
  }
}

// A loaded session waits here until its tracks' files are opened.
let pendingSession = null
function applyPendingSession() {
  if (!pendingSession) return
  if (pendingSession.mode) { const m = pendingSession.mode; delete pendingSession.mode; setMode(m) } // once
  trackList = applySessionTracks(pendingSession, trackList)
  genome = applySessionView(pendingSession, genome)
}

async function loadSessionFile(file) {
  try {
    pendingSession = parseSession(await file.text())
    applyPendingSession()
    rebuildPanel()
    requestRender()
    showError(`Session "${file.name}" loaded. Open its data files (same names) to restore tracks.`)
  } catch (err) {
    showError(`Couldn't read session: ${err.message}`)
  }
}

function saveSession() {
  const blob = new Blob([JSON.stringify(captureSession(genome, trackList, mode), null, 2)], { type: 'application/json' })
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${genome?.name ?? 'orbit'}_session.json` })
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

// ---- panel -----------------------------------------------------------------

function update(next, { rebuild = false } = {}) {
  trackList = next
  if (rebuild) rebuildPanel()
  requestRender()
}

function rebuildPanel() {
  renderTrackPanel(panel, trackList, {
    onVisibility: (id, v) => update(setVisibility(trackList, id, v)),
    onColor: (id, c) => update(setColor(trackList, id, c)),
    onColorMinus: (id, c) => update(trackList.map((t) => (t.id === id ? { ...t, colorMinus: c } : t))),
    onReorder: (id, order) => update(reorderTrack(trackList, id, order), { rebuild: true }),
    onRemove: (id) => { bigWigHandles.delete(id); update(removeTrack(trackList, id), { rebuild: true }) },
    onWeight: (id, w) => update(setWeight(trackList, id, w)),
    onYScale: (id, patch, rebuild) => update(setYScale(trackList, id, patch), { rebuild: !!rebuild }),
    onBinCount: (id, n) => update(setBinCount(trackList, id, n)),
    onSmooth: (id, bp) => update(setTrackProp(trackList, id, { smooth: bp })),
    onSharpen: (id, v) => update(setTrackProp(trackList, id, { sharpen: v })),
    onOverlay: (id, otherId) => {
      const other = trackList.find((t) => t.id === otherId)
      const size = other?.group ? trackList.filter((t) => t.group === other.group).length : 1
      if (other && size >= 2 && !confirm(`${size + 1} overlaid samples on one ring can be hard to read — continue?`)) return rebuildPanel()
      update(setOverlay(trackList, id, otherId), { rebuild: true })
    },
  })
}

// ---- hover / click ---------------------------------------------------------

function locate(event) {
  if (!genome || !scene || !scene.bands) return null
  if (mode === 'linear') {
    // Same shape as the circular result: r is the y coordinate, bands carry top/bottom.
    const rect = svg.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const { x0, w, top, bottom } = scene.plot
    const inPlot = x >= x0 && x <= x0 + w && y >= top && y <= bottom
    const rel = clamp((x - x0) / w, 0, 1) * genome.view.span
    const band = inPlot ? scene.bands.find((b) => y >= b.top && y <= b.bottom) : undefined
    return { r: y, x, rel, bp: bpAtRel(genome, rel), band, inPlot }
  }
  const r = radiusOf(svg, event)
  const rel = fracOf(svg, event) * genome.view.span
  const bp = bpAtRel(genome, rel)
  const band = scene.bands.find((b) => r >= b.innerRadius && r <= b.outerRadius)
  return { r, rel, bp, band }
}

function describe(loc) {
  const { band, rel, bp } = loc
  const pos = `${genome.name}:${Math.floor(bp + 1).toLocaleString('en-US')}`
  if (!band) return { text: pos, feature: null }
  if (band.track.type === 'annotation') {
    const hit = (band.hits || []).find((h) => loc.r >= h.inner && loc.r <= h.outer && rel >= h.rel0 && rel <= h.rel1)
    if (!hit) return { text: `${band.track.name}\n${pos}`, feature: null }
    const f = hit.feature
    const len = f.end >= f.start ? f.end - f.start : f.end + genome.length - f.start
    return {
      text: `${f.name}${f.strand ? ` (${f.strand})` : ''}\n${f.start + 1}–${f.end}  ·  ${len.toLocaleString('en-US')} bp${f.type && f.type !== 'feature' ? `\n${f.type}` : ''}`,
      feature: f,
    }
  }
  if (!band.members?.length) return { text: pos, feature: null }
  const lines = band.members.map(({ track, data: d }) => {
    const bins = d.bins || d.plusBins
    const size = bins[0].end - bins[0].start
    // Bins may start before the window (integer-bp snapping), so index from the first bin.
    const i = Math.max(0, Math.min(bins.length - 1, Math.floor((genome.view.start + rel - bins[0].start) / size)))
    const value = d.bins
      ? `${fmtVal(d.bins[i].value)}`
      : `+${fmtVal(Math.abs(d.plusBins[i].value))}  −${fmtVal(Math.abs(d.minusBins[i].value))}`
    return band.members.length > 1 ? `${track.name}: ${value}` : `${track.name}\n${pos}  ·  ${value}`
  })
  return { text: band.members.length > 1 ? `${pos}\n${lines.join('\n')}` : lines[0], feature: null }
}

// Gene (or other feature) covering a position, from any visible annotation track.
function featureAt(bp) {
  for (const t of visibleTracksInOrder(trackList)) {
    if (t.type !== 'annotation') continue
    const hit = annotationForChrom(t).features.find((f) => (f.end >= f.start ? bp >= f.start && bp < f.end : bp >= f.start || bp < f.end))
    if (hit) return hit
  }
  return null
}

svg.addEventListener('pointermove', (event) => {
  const loc = locate(event)
  if (!loc) return
  const f = featureAt(loc.bp)
  $('pos').textContent = `${genome.name}:${Math.floor(loc.bp + 1).toLocaleString('en-US')}${f ? ` · ${f.name}` : ''}`
  const rect = canvasArea.getBoundingClientRect()
  if (mode === 'linear' ? loc.inPlot : loc.r <= scene.rulerR + 6) {
    tooltip.textContent = describe(loc).text
    tooltip.style.display = 'block'
    tooltip.style.left = `${event.clientX - rect.left + 14}px`
    tooltip.style.top = `${event.clientY - rect.top + 14}px`
    // Cursor guide: radial in the circle, vertical in the linear view.
    const a = (loc.rel / genome.view.span) * TAU - Math.PI / 2
    const line = overlay.firstChild || overlay.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'line'))
    const [x1, y1, x2, y2] = mode === 'linear'
      ? [loc.x, scene.plot.top, loc.x, scene.plot.bottom]
      : [scene.cx + scene.minRadius * Math.cos(a), scene.cy + scene.minRadius * Math.sin(a), scene.cx + scene.rulerR * Math.cos(a), scene.cy + scene.rulerR * Math.sin(a)]
    line.setAttribute('x1', x1)
    line.setAttribute('y1', y1)
    line.setAttribute('x2', x2)
    line.setAttribute('y2', y2)
    line.setAttribute('stroke', theme().accent)
    line.setAttribute('stroke-width', 1)
    line.setAttribute('stroke-opacity', 0.6)
  } else {
    tooltip.style.display = 'none'
    overlay.replaceChildren()
  }
})
svg.addEventListener('pointerleave', () => { tooltip.style.display = 'none'; overlay.replaceChildren(); $('pos').textContent = '' })

function onSvgClick(event) {
  const m = scene?.minimap
  if (m && mode === 'linear') {
    // Click on the minimap strip: centre the window on that bp.
    const rect = svg.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    if (x >= m.x && x <= m.x + m.w && y >= m.y - 4 && y <= m.y + m.h + 4) {
      genome = setView(genome, ((x - m.x) / m.w) * genome.length - genome.view.span / 2, genome.view.span)
      return requestRender()
    }
  } else if (m) {
    const rect = svg.getBoundingClientRect()
    const dx = event.clientX - rect.left - m.x
    const dy = event.clientY - rect.top - m.y
    if (Math.hypot(dx, dy) <= m.r + 4) {
      // Click on the minimap: centre the window on that bp.
      const frac = ((((Math.atan2(dy, dx) + Math.PI / 2) / TAU) % 1) + 1) % 1
      genome = setView(genome, frac * genome.length - genome.view.span / 2, genome.view.span)
      return requestRender()
    }
  }
  const loc = locate(event)
  if (!loc || !loc.band) return
  const { feature } = describe(loc)
  if (feature) { genome = zoomToRange(genome, feature.start, feature.end); requestRender() }
}

// ---- search ----------------------------------------------------------------

const searchBox = $('search')
const searchList = $('search-list')
function searchFeatures(q) {
  q = q.toLowerCase()
  const hits = []
  for (const t of trackList) if (t.type === 'annotation') for (const f of t.features) {
    const n = f.name.toLowerCase()
    if (n.startsWith(q)) hits.push([0, f])
    else if (n.includes(q)) hits.push([1, f])
  }
  return hits.sort((a, b) => a[0] - b[0] || a[1].name.length - b[1].name.length).slice(0, 20).map((h) => h[1])
}

function goToFeature(f) {
  const chrom = [...chromSelect.options].find((o) => normChrom(o.value) === normChrom(f.chrom))?.value ?? f.chrom
  if (!genome || genome.name !== chrom) {
    genome = resetView(createGenome(chromLengthFor(chrom) || f.chromLength || Math.max(f.start, f.end), chrom))
    chromSelect.value = chrom
  }
  genome = zoomToRange(genome, f.start, f.end)
  requestRender()
}

searchBox.addEventListener('input', () => {
  searchList.replaceChildren(...(searchBox.value.length < 2 ? [] : searchFeatures(searchBox.value)).map((f) =>
    Object.assign(document.createElement('option'), { value: f.name, label: `${f.chrom}:${(f.start + 1).toLocaleString('en-US')}-${f.end.toLocaleString('en-US')}` })))
})
searchBox.addEventListener('change', () => {
  const q = searchBox.value.trim().toLowerCase()
  const f = q && (searchFeatures(q).find((x) => x.name.toLowerCase() === q) ?? searchFeatures(q)[0])
  if (f) { goToFeature(f); searchBox.blur() } else if (q) showError(`No feature matches "${searchBox.value}".`)
})
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && !e.metaKey && !e.ctrlKey) { e.preventDefault(); searchBox.focus() }
})

// ---- wiring ----------------------------------------------------------------

canvasArea.addEventListener('dragover', (e) => { e.preventDefault(); canvasArea.classList.add('dragover') })
canvasArea.addEventListener('dragleave', () => canvasArea.classList.remove('dragover'))
canvasArea.addEventListener('drop', (e) => {
  e.preventDefault()
  canvasArea.classList.remove('dragover')
  handleFiles([...e.dataTransfer.files])
})
$('open-files').addEventListener('click', () => $('file-input').click())
$('file-input').addEventListener('change', (e) => { handleFiles([...e.target.files]); e.target.value = '' })
$('fetch-annotation').addEventListener('click', fetchAnnotation)
$('save-session').addEventListener('click', () => genome && saveSession())
$('load-session').addEventListener('click', () => $('session-input').click())
$('session-input').addEventListener('change', (e) => { if (e.target.files[0]) loadSessionFile(e.target.files[0]); e.target.value = '' })
$('reset-zoom').addEventListener('click', () => { if (genome) { genome = resetView(genome); requestRender() } })
chromSelect.addEventListener('change', () => {
  genome = resetView(createGenome(chromLengthFor(chromSelect.value) || genome.length, chromSelect.value))
  requestRender()
})
$('export-svg').addEventListener('click', () => genome && exportSvg(svg, `${genome.name}_orbit`))
$('export-html').addEventListener('click', () => genome && exportHtml(svg, `${genome.name}_orbit`))
$('export-png').addEventListener('click', () => genome && exportPng(svg, `${genome.name}_orbit`).catch((e) => showError(e.message)))
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
function patchSignals(fn) {
  update(trackList.map((t) => (t.type === 'signal' ? { ...t, ...fn(t) } : t)), { rebuild: true })
}
const kbro = () => ySettings.kbro && mode === 'linear'
const stepSmooth = (bp, up) => kbro() ? clamp(bp + (up ? 10 : -10), 0, 2000) : (up ? clamp(bp ? Math.round(bp * 1.5) : 50, 0, 2000) : bp <= 50 ? 0 : Math.round(bp / 1.5))
const helpEl = $('help')
function setMode(next) {
  mode = next
  scene = null
  if (mode === 'linear' && genome && isFullView(genome)) genome = resetView(genome)
  $('mode-btn').textContent = mode === 'linear' ? 'Circular view' : 'Linear view'
  overlay.replaceChildren()
  $('pos').textContent = ''
  requestRender()
}
const toggleMode = () => setMode(mode === 'linear' ? 'circular' : 'linear')
$('mode-btn').addEventListener('click', toggleMode)
const KEYS = {
  v: toggleMode,
  r: () => { genome = resetView(genome); ySettings.gain.clear(); requestRender() },
  j: () => { ySettings.kbro = !ySettings.kbro; ySettings.gain.clear(); requestRender() },
  '[': () => { ySettings.factor = clamp(ySettings.factor / 1.25, 0.1, 10); requestRender() },
  ']': () => { ySettings.factor = clamp(ySettings.factor * 1.25, 0.1, 10); requestRender() },
  a: () => {
    ySettings.locked = null
    ySettings.gain.clear()
    if (kbro()) { ySettings.fit = true; requestRender(); return } // kbro: refit on the next draw
    afterRender = () => { ySettings.locked = new Map(scene.bandMax); requestRender() }
    requestRender()
  },
  // kbro's own keys: zoom and pan in fixed steps around the view centre (linear kbro mode only).
  z: () => kbro() && (genome = zoomAt(genome, 0.8, 0.5), requestRender()),
  x: () => kbro() && (genome = zoomAt(genome, 1.25, 0.5), requestRender()),
  '.': () => kbro() && (genome = panBy(genome, genome.view.span * 0.125), requestRender()),
  ',': () => kbro() && (genome = panBy(genome, -genome.view.span * 0.125), requestRender()),
  '>': () => kbro() && (genome = panBy(genome, genome.view.span * 0.5), requestRender()),
  '<': () => kbro() && (genome = panBy(genome, -genome.view.span * 0.5), requestRender()),
  q: () => kbro() && KEYS['['](),
  w: () => kbro() && KEYS[']'](),
  A: () => { ySettings.locked = null; ySettings.gain.clear(); requestRender() },
  p: () => { ySettings.shared = !ySettings.shared; requestRender() },
  s: () => patchSignals((t) => ({ smooth: stepSmooth(t.smooth, false) })),
  S: () => patchSignals((t) => ({ smooth: stepSmooth(t.smooth, true) })),
  k: () => patchSignals((t) => ({ sharpen: clamp(t.sharpen - 10, 0, 100) })),
  K: () => patchSignals((t) => ({ sharpen: clamp(t.sharpen + 10, 0, 100) })),
  b: () => patchSignals((t) => ({ binCount: clamp(Math.round((t.binCount || lastAutoBins) / 1.5), 50, 5000) })),
  B: () => patchSignals((t) => ({ binCount: clamp(Math.round((t.binCount || lastAutoBins) * 1.5), 50, 5000) })),
  '?': () => { helpEl.hidden = !helpEl.hidden },
  Escape: () => { helpEl.hidden = true },
}
document.addEventListener('keydown', (e) => {
  if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) || e.metaKey || e.ctrlKey || e.altKey) return
  const key = e.key.length === 1 && e.key.toLowerCase() === 'r' ? 'r' : e.key
  if (!KEYS[key] || (!genome && key !== '?' && key !== 'Escape')) return
  KEYS[key]()
})
// Global bar: sliders apply to every signal track; rebuild the panel only when released.
const setAllSignals = (patch, rebuild) => update(trackList.map((t) => (t.type === 'signal' ? { ...t, ...patch } : t)), { rebuild })
for (const [id, key] of [['g-smooth', 'smooth'], ['g-sharpen', 'sharpen']]) {
  $(id).addEventListener('input', (e) => setAllSignals({ [key]: Number(e.target.value) }, false))
  $(id).addEventListener('change', rebuildPanel)
}
$('g-shared').addEventListener('change', (e) => { ySettings.shared = e.target.checked; requestRender() })
$('g-lock').addEventListener('change', (e) => (e.target.checked ? KEYS.a() : KEYS.A()))
$('g-ydown').addEventListener('click', KEYS['['])
$('g-yup').addEventListener('click', KEYS[']'])
$('help-btn').addEventListener('click', () => { helpEl.hidden = !helpEl.hidden })
$('help-close').addEventListener('click', () => { helpEl.hidden = true })
new ResizeObserver(requestRender).observe(canvasArea)
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', requestRender)

// getGenome is a getter: handlers are attached once, before any file loads.
// Each attach is active only in its own mode (getGenome returns null otherwise).
// The full linear view has no rotation, so it always starts at bp 1.
const setGenome = (next) => { genome = mode === 'linear' && isFullView(next) ? resetView(next) : next; requestRender() }
attachZoomPan(svg, () => (mode === 'circular' ? genome : null), setGenome, onSvgClick)
attachLinearZoomPan(svg, () => (mode === 'linear' ? genome : null), () => scene?.plot, setGenome, onSvgClick, kbro)
rebuildPanel()

// Test/debug hook.
window.orbit = { get genome() { return genome }, get tracks() { return trackList }, handleFiles }
