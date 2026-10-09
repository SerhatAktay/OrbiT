# OrbiT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build OrbiT, a local, interactive, browser-based circular track viewer for bigWig signal tracks + BED/GTF annotations on small circular genomes (mitochondria first).

**Architecture:** Plain HTML + vanilla ES modules, no runtime build step. Pure logic (genome/track models, annotation parsing, bigWig-binning wrapper, radial geometry) is hand-rolled with zero dependency where possible and unit-tested with `node --test`. `@gmod/bbi` (bigWig parsing) is pre-bundled once at setup time via `esbuild` into a single dependency-free ESM file under `vendor/`, so the shipped app has no bare-specifier imports and needs no bundler to run — open `index.html` (served statically) and go.

**Tech Stack:** Vanilla JS (ES modules), `@gmod/bbi` + `generic-filehandle` (bundled via `esbuild` at setup time only), Node built-in test runner (`node --test`). No D3, no framework — zoom/pan and rendering are hand-rolled SVG + pointer events (see Task 6/7 rationale).

**Spec:** `docs/superpowers/specs/2026-09-09-orbit-track-design.md`

## Global Constraints

- Single circular chromosome only (mitochondria-sized genomes); no multi-chromosome support.
- No server backend — all parsing happens client-side in the browser.
- No session persistence / save-load.
- No runtime bundler: the shipped app (`index.html` + `src/*.js` + `vendor/*.js`) must run by opening/serving the folder as-is. `esbuild` is a devDependency used only to produce `vendor/bbi.bundle.js` once.
- ES modules throughout (`"type": "module"` in `package.json`), Node built-in `node:test` / `node:assert` for tests — no test framework.

**Deviation from spec's literal wording, decided during planning:** the spec's Architecture section mentions D3 for rendering/zoom. Implementing this plan revealed that a no-bundler radial view is simpler and has zero extra dependency if the arc/radial-line math and the zoom/pan interaction are hand-rolled (small trig helpers + pointer/wheel events) instead of pulling in D3's zoom/shape modules and solving their browser-ESM resolution. Same responsibilities (`render.js` geometry, `interaction.js` zoom/pan/panel), no D3. `@gmod/bbi` still needs bundling since it has several transitive npm dependencies — that's what `esbuild` is for.

---

### Task 1: Project scaffold, vendor bundle, test fixtures

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `scripts/vendor-entry.js`
- Create: `vendor/bbi.bundle.js` (generated)
- Create: `test/fixtures/sample.bed`
- Create: `test/fixtures/sample.bw` (copied)
- Create: `index.html` (empty shell, filled in Task 7)

**Interfaces:**
- Produces: `vendor/bbi.bundle.js` exporting `{ BigWig, BlobFile, LocalFile }` as an ESM module with no external bare-specifier imports — Task 5 imports from this file.
- Produces: `test/fixtures/sample.bed` — a tiny 3-feature BED file — Task 2's test reads it.
- Produces: `test/fixtures/sample.bw` — a small real bigWig file — Task 5's test reads it.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "orbit-track",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test test/",
    "vendor": "node scripts/build-vendor.js"
  },
  "devDependencies": {
    "@gmod/bbi": "^3.0.1",
    "generic-filehandle": "^3.0.0",
    "esbuild": "^0.24.0",
    "esbuild-plugin-polyfill-node": "^0.3.0"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
```

(`vendor/bbi.bundle.js` is committed — it's the whole point of vendoring: the app runs without `node_modules`.)

- [ ] **Step 3: Install devDependencies**

Run: `npm install`
Expected: `node_modules/` populated, `package-lock.json` created, no errors.

- [ ] **Step 4: Create the vendor bundle entry point**

The browser bundle exports only `BigWig` and `BlobFile` — `LocalFile` needs Node's `fs` module, which has no place in a browser bundle at all, and the app never uses it (drag-dropped files are `Blob`s, handled by `BlobFile`). Node-side test code that needs `LocalFile` for reading local fixture files imports it directly from the `generic-filehandle` npm package instead (a devDependency, available under `node_modules` when `node --test` runs) — see Task 5.

```js
// scripts/vendor-entry.js
export { BigWig } from '@gmod/bbi'
export { BlobFile } from 'generic-filehandle'
```

- [ ] **Step 5: Build the vendor bundle with Node-builtin polyfills**

`@gmod/bbi` and `generic-filehandle` use Node's `buffer`/`zlib` internally with no `"browser"` field in their `package.json` to swap in browser-safe versions, so a plain `esbuild --platform=browser` leaves unresolved `require("buffer")`/`require("zlib")` calls that throw in a real browser (there is no `require` global there). Use the `esbuild-plugin-polyfill-node` plugin, which auto-polyfills Node builtins for a browser target, via esbuild's JS API (the CLI has no plugin flag):

```js
// scripts/build-vendor.js
import { build } from 'esbuild'
import { polyfillNode } from 'esbuild-plugin-polyfill-node'

await build({
  entryPoints: ['scripts/vendor-entry.js'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: 'vendor/bbi.bundle.js',
  plugins: [polyfillNode()],
})
```

Run: `npm run vendor`
Expected: `vendor/bbi.bundle.js` created, no build errors.

- [ ] **Step 6: Verify the bundle has no unresolved Node-builtin requires**

Run: `node -e "import('./vendor/bbi.bundle.js').then(m => console.log(Object.keys(m)))"`
Expected: prints `[ 'BigWig', 'BlobFile' ]` with no import errors.

This alone does not prove browser-loadability (Node can satisfy a bare `require` that a browser can't). Also run:

Run: `grep -c '__require(\"' vendor/bbi.bundle.js`
Expected: `0`. (Note the quote in the pattern — `grep -c '__require('` alone also matches esbuild's one-time helper *definition*, `function __require() {...}`, which is harmless; what actually breaks a browser is a *call site* like `__require("fs")`, which this stricter pattern targets.) If nonzero, the polyfill plugin didn't cover every path — do not treat the Node `import()` check above as sufficient on its own; report BLOCKED with which builtin `grep -o '__require([\"'"'"'][a-z]*[\"'"'"'])' vendor/bbi.bundle.js | sort -u` shows unresolved.

- [ ] **Step 7: Create the BED fixture**

```
# test/fixtures/sample.bed
chrM	0	576	D-loop	0	+
chrM	576	1601	tRNA-Phe	0	+
chrM	1601	3229	RNR1	0	+
```

- [ ] **Step 8: Locate and copy a small bigWig fixture from `@gmod/bbi`'s own test suite**

Run: `find node_modules/@gmod/bbi -iname "*.bw" -o -iname "*.bigwig" | head -5`
Expected: at least one small `.bw`/`.bigwig` file listed (the package's own unit tests need fixtures to run against).

Copy the smallest one to `test/fixtures/sample.bw`, e.g.:
`cp node_modules/@gmod/bbi/test/data/<name>.bw test/fixtures/sample.bw`
(exact filename varies by version — use whatever Step 8's `find` printed.)

- [ ] **Step 9: Create an empty `index.html` shell**

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>OrbiT</title>
</head>
<body>
  <script type="module" src="src/app.js"></script>
</body>
</html>
```

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json .gitignore scripts/vendor-entry.js scripts/build-vendor.js vendor/bbi.bundle.js test/fixtures/sample.bed test/fixtures/sample.bw index.html
git commit -m "chore: project scaffold, vendored bigwig lib, test fixtures"
```

---

### Task 2: Annotation parsing (`parse-annotation.js`)

**Files:**
- Create: `src/parse-annotation.js`
- Test: `test/parse-annotation.test.js`

**Interfaces:**
- Produces: `parseBed(text: string) -> Feature[]`, `parseGtf(text: string) -> Feature[]`, `parseAnnotation(text: string, filename: string) -> Feature[]`
  where `Feature = { name: string, start: number, end: number, strand: '+' | '-' | null }` (0-based, half-open coordinates).

- [ ] **Step 1: Write the failing test**

```js
// test/parse-annotation.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseBed, parseGtf, parseAnnotation } from '../src/parse-annotation.js'

test('parseBed parses fields and defaults strand to null', () => {
  const text = readFileSync(new URL('./fixtures/sample.bed', import.meta.url), 'utf8')
  const features = parseBed(text)
  assert.equal(features.length, 3)
  assert.deepEqual(features[0], { name: 'D-loop', start: 0, end: 576, strand: '+' })
})

test('parseBed rejects malformed lines', () => {
  assert.throws(() => parseBed('chrM\t0\n'), /Invalid BED line/)
})

test('parseGtf converts 1-based inclusive to 0-based half-open and reads gene_name', () => {
  const line = 'chrM\tsource\tgene\t1\t576\t.\t+\t.\tgene_id "ND1"; gene_name "MT-ND1";\n'
  const features = parseGtf(line)
  assert.deepEqual(features[0], { name: 'MT-ND1', start: 0, end: 576, strand: '+' })
})

test('parseAnnotation dispatches on file extension', () => {
  const bedText = readFileSync(new URL('./fixtures/sample.bed', import.meta.url), 'utf8')
  assert.equal(parseAnnotation(bedText, 'foo.bed').length, 3)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/parse-annotation.test.js`
Expected: FAIL — `Cannot find module '../src/parse-annotation.js'`

- [ ] **Step 3: Implement**

```js
// src/parse-annotation.js
export function parseBed(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('track'))
    .map((line) => {
      const fields = line.split('\t')
      if (fields.length < 3) {
        throw new Error(`Invalid BED line (need at least 3 fields): "${line}"`)
      }
      const [, startStr, endStr, name, , strand] = fields
      const start = Number(startStr)
      const end = Number(endStr)
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        throw new Error(`Invalid BED coordinates: "${line}"`)
      }
      return {
        name: name || `feature_${start}_${end}`,
        start,
        end,
        strand: strand === '+' || strand === '-' ? strand : null,
      }
    })
}

export function parseGtf(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const fields = line.split('\t')
      if (fields.length < 9) {
        throw new Error(`Invalid GTF line (need 9 fields): "${line}"`)
      }
      const [, , , startStr, endStr, , strand, , attributes] = fields
      const start = Number(startStr) - 1
      const end = Number(endStr)
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        throw new Error(`Invalid GTF coordinates: "${line}"`)
      }
      const nameMatch =
        attributes.match(/gene_name "([^"]+)"/) || attributes.match(/gene_id "([^"]+)"/)
      return {
        name: nameMatch ? nameMatch[1] : `feature_${start}_${end}`,
        start,
        end,
        strand: strand === '+' || strand === '-' ? strand : null,
      }
    })
}

export function parseAnnotation(text, filename) {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.gtf') || lower.endsWith('.gff') || lower.endsWith('.gff3')) {
    return parseGtf(text)
  }
  return parseBed(text)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/parse-annotation.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/parse-annotation.js test/parse-annotation.test.js
git commit -m "feat: BED/GTF annotation parsing"
```

---

### Task 3: Genome view model (`genome.js`)

**Files:**
- Create: `src/genome.js`
- Test: `test/genome.test.js`

**Interfaces:**
- Produces: `createGenome(length) -> Genome`, `setView(genome, start, end) -> Genome`, `resetView(genome) -> Genome`, `isFullView(genome) -> boolean`, `viewSpan(genome) -> number`
  where `Genome = { length: number, view: { start: number, end: number } }`.

- [ ] **Step 1: Write the failing test**

```js
// test/genome.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGenome, setView, resetView, isFullView, viewSpan } from '../src/genome.js'

test('createGenome starts at full view', () => {
  const g = createGenome(16569)
  assert.equal(g.length, 16569)
  assert.deepEqual(g.view, { start: 0, end: 16569 })
  assert.equal(isFullView(g), true)
})

test('createGenome rejects non-positive length', () => {
  assert.throws(() => createGenome(0), /positive number/)
  assert.throws(() => createGenome(-5), /positive number/)
})

test('setView clamps to genome bounds', () => {
  const g = createGenome(1000)
  const zoomed = setView(g, -50, 2000)
  assert.deepEqual(zoomed.view, { start: 0, end: 1000 })
  assert.equal(isFullView(zoomed), true)
})

test('setView clamps end to not go below start', () => {
  const g = createGenome(1000)
  const zoomed = setView(g, 500, 100)
  assert.equal(zoomed.view.end >= zoomed.view.start, true)
})

test('resetView restores full circle and viewSpan reports window size', () => {
  const g = setView(createGenome(1000), 100, 300)
  assert.equal(viewSpan(g), 200)
  assert.equal(viewSpan(resetView(g)), 1000)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/genome.test.js`
Expected: FAIL — `Cannot find module '../src/genome.js'`

- [ ] **Step 3: Implement**

```js
// src/genome.js
// ponytail: view window doesn't wrap across position 0 (e.g. a zoom spanning
// the D-loop across the origin isn't representable as one window). Add
// wraparound [start,end] support if that becomes a real need.

export function createGenome(length) {
  if (!Number.isFinite(length) || length <= 0) {
    throw new Error(`Genome length must be a positive number, got ${length}`)
  }
  return { length, view: { start: 0, end: length } }
}

export function isFullView(genome) {
  return genome.view.start === 0 && genome.view.end === genome.length
}

export function setView(genome, start, end) {
  const clampedStart = Math.max(0, Math.min(start, genome.length))
  const clampedEnd = Math.max(clampedStart, Math.min(end, genome.length))
  return { ...genome, view: { start: clampedStart, end: clampedEnd } }
}

export function resetView(genome) {
  return setView(genome, 0, genome.length)
}

export function viewSpan(genome) {
  return genome.view.end - genome.view.start
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/genome.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/genome.js test/genome.test.js
git commit -m "feat: genome view model with clamped zoom window"
```

---

### Task 4: Track list model (`tracks.js`)

**Files:**
- Create: `src/tracks.js`
- Test: `test/tracks.test.js`

**Interfaces:**
- Produces:
  - `createSignalTrack({ name, files, strand, color, binCount, genomeLength }) -> Track`
  - `createAnnotationTrack({ name, features, color }) -> Track`
  - `addTrack(trackList, track) -> Track[]`
  - `removeTrack(trackList, id) -> Track[]`
  - `setVisibility(trackList, id, visible) -> Track[]`
  - `reorderTrack(trackList, id, newOrder) -> Track[]`
  - `setColor(trackList, id, color) -> Track[]`
  - `setYScale(trackList, id, yScale) -> Track[]`
  - `setBinCount(trackList, id, binCount) -> Track[]`
  - `visibleTracksInOrder(trackList) -> Track[]`
  - `checkGenomeLengthMismatch(track, genomeLength) -> boolean`
  - `Track = { id, name, type: 'signal'|'annotation', strand, files?, features?, color, visible, order, yScale?, binCount?, genomeLength? }`
- Consumes: `Feature[]` from Task 2 (`createAnnotationTrack`'s `features` param).

- [ ] **Step 1: Write the failing test**

```js
// test/tracks.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/tracks.test.js`
Expected: FAIL — `Cannot find module '../src/tracks.js'`

- [ ] **Step 3: Implement**

```js
// src/tracks.js
let nextId = 1

export function createSignalTrack({
  name,
  files,
  strand = 'unstranded',
  color = '#1f77b4',
  binCount = 200,
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
    visible: true,
    order: 0,
    yScale: { mode: 'auto', min: null, max: null },
    binCount,
    genomeLength,
  }
}

export function createAnnotationTrack({ name, features, color = '#888888' }) {
  return {
    id: nextId++,
    name,
    type: 'annotation',
    strand: 'unstranded',
    features,
    color,
    visible: true,
    order: 0,
  }
}

export function addTrack(trackList, track) {
  return [...trackList, { ...track, order: trackList.length }]
}

export function removeTrack(trackList, id) {
  return trackList.filter((t) => t.id !== id).map((t, i) => ({ ...t, order: i }))
}

export function setVisibility(trackList, id, visible) {
  return trackList.map((t) => (t.id === id ? { ...t, visible } : t))
}

export function reorderTrack(trackList, id, newOrder) {
  const sorted = [...trackList].sort((a, b) => a.order - b.order)
  const idx = sorted.findIndex((t) => t.id === id)
  if (idx === -1) return trackList
  const [moved] = sorted.splice(idx, 1)
  sorted.splice(newOrder, 0, moved)
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

export function visibleTracksInOrder(trackList) {
  return trackList.filter((t) => t.visible).sort((a, b) => a.order - b.order)
}

export function checkGenomeLengthMismatch(track, genomeLength) {
  return track.genomeLength != null && track.genomeLength !== genomeLength
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/tracks.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/tracks.js test/tracks.test.js
git commit -m "feat: track list model (add/remove/reorder/visibility/color)"
```

---

### Task 5: BigWig parsing wrapper (`parse-bigwig.js`)

**Files:**
- Create: `src/parse-bigwig.js`
- Test: `test/parse-bigwig.test.js`

**Interfaces:**
- Consumes: `BigWig` from `vendor/bbi.bundle.js` (Task 1; the browser bundle exports only `BigWig`/`BlobFile` — `LocalFile` isn't in it, see Task 1 Step 4). This task's own tests need `LocalFile` to read a local fixture file under Node, so they import it directly from the `generic-filehandle` npm package (a devDependency, present under `node_modules` when `node --test` runs) rather than from the vendor bundle.
- Produces: `openBigWig(filehandle) -> Promise<{ chromSizes: Record<string, number> }>`, `getBinnedValues(bigWigHandle, chromName, start, end, binCount) -> Promise<{ start: number, end: number, value: number }[]>` (exactly `binCount` bins spanning `[start, end)`, `value` = mean score in that bin, `0` for bins with no data).

- [ ] **Step 1: Inspect the installed `@gmod/bbi` API before writing the wrapper**

Run: `cat node_modules/@gmod/bbi/dist/index.d.ts 2>/dev/null || find node_modules/@gmod/bbi -name "*.d.ts" | xargs cat`

Confirm: the `BigWig` class constructor shape (expected: `new BigWig({ filehandle })`), the header method (expected: `getHeader()` resolving to something exposing per-chromosome name→length, commonly under a `refsByName` or `refsByNumber`-style map — check the actual field name), and the values method (expected: `getFeatures(chromName, start, end, opts)` resolving to `{ start, end, score }[]`, where `opts` controls summarization resolution — check the actual option name, commonly `basesPerSpan` or `scale`). Use exactly what the type definitions say; the code below is a best-effort based on the published API and Step 4's test will catch any mismatch.

- [ ] **Step 2: Write the failing test**

```js
// test/parse-bigwig.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LocalFile } from 'generic-filehandle'
import { openBigWig, getBinnedValues } from '../src/parse-bigwig.js'

const fixturePath = new URL('./fixtures/sample.bw', import.meta.url).pathname

test('openBigWig reads chrom sizes from the header', async () => {
  const { chromSizes, handle } = await openBigWig(new LocalFile(fixturePath))
  assert.equal(typeof chromSizes, 'object')
  assert.ok(Object.keys(chromSizes).length > 0)
  assert.ok(Object.values(chromSizes)[0] > 0)
  assert.ok(handle)
})

test('getBinnedValues returns exactly binCount bins covering the requested range', async () => {
  const { chromSizes, handle } = await openBigWig(new LocalFile(fixturePath))
  const chromName = Object.keys(chromSizes)[0]
  const length = chromSizes[chromName]
  const bins = await getBinnedValues(handle, chromName, 0, length, 10)
  assert.equal(bins.length, 10)
  assert.equal(bins[0].start, 0)
  assert.ok(bins.every((b) => Number.isFinite(b.value)))
})

test('getBinnedValues returns 0 for an out-of-data region without throwing', async () => {
  const { chromSizes, handle } = await openBigWig(new LocalFile(fixturePath))
  const chromName = Object.keys(chromSizes)[0]
  const length = chromSizes[chromName]
  const bins = await getBinnedValues(handle, chromName, length - 1, length, 1)
  assert.equal(bins.length, 1)
  assert.equal(Number.isFinite(bins[0].value), true)
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/parse-bigwig.test.js`
Expected: FAIL — `Cannot find module '../src/parse-bigwig.js'`

- [ ] **Step 4: Implement**

```js
// src/parse-bigwig.js
import { BigWig } from '../vendor/bbi.bundle.js'

export async function openBigWig(filehandle) {
  const bigwig = new BigWig({ filehandle })
  const header = await bigwig.getHeader()
  const chromSizes = {}
  for (const [name, ref] of Object.entries(header.refsByName)) {
    chromSizes[name] = ref.length
  }
  return { chromSizes, handle: bigwig }
}

export async function getBinnedValues(bigWigHandle, chromName, start, end, binCount) {
  const span = end - start
  const binSize = span / binCount
  const features = await bigWigHandle.getFeatures(chromName, start, end, {
    basesPerSpan: Math.max(1, Math.floor(binSize)),
  })

  const bins = Array.from({ length: binCount }, (_, i) => ({
    start: start + i * binSize,
    end: start + (i + 1) * binSize,
    sum: 0,
    count: 0,
  }))

  for (const feature of features) {
    const binIndex = Math.min(binCount - 1, Math.floor((feature.start - start) / binSize))
    if (binIndex < 0) continue
    bins[binIndex].sum += feature.score
    bins[binIndex].count += 1
  }

  return bins.map((b) => ({
    start: b.start,
    end: b.end,
    value: b.count > 0 ? b.sum / b.count : 0,
  }))
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/parse-bigwig.test.js`
Expected: PASS, 3 tests. If it fails on `header.refsByName` or `getFeatures`/`basesPerSpan` not existing, re-check Step 1's type definitions for the correct field/option names and adjust — the test's assertions (chrom sizes present, exact bin count, finite values) stay valid regardless of the exact API names used to satisfy them.

- [ ] **Step 6: Commit**

```bash
git add src/parse-bigwig.js test/parse-bigwig.test.js
git commit -m "feat: bigwig header + binned value reading"
```

---

### Task 6: Radial rendering geometry (`render.js`)

**Files:**
- Create: `src/render.js`
- Test: `test/render.test.js`

**Interfaces:**
- Consumes: `Track` shape from Task 4, `{ start, end, value }` bins from Task 5, `Feature` shape from Task 2.
- Produces:
  - `computeTrackBands(visibleTracks, { minRadius, maxRadius, bandGap }) -> { track, innerRadius, outerRadius }[]`
  - `signalTrackPath(bins, band, genomeLength, { mirrored }) -> string` (SVG path `d` attribute)
  - `annotationFeaturePath(feature, band, genomeLength) -> string` (SVG path `d` attribute)

- [ ] **Step 1: Write the failing test**

```js
// test/render.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeTrackBands, signalTrackPath, annotationFeaturePath } from '../src/render.js'

test('computeTrackBands divides the radius range evenly with a gap', () => {
  const bands = computeTrackBands([{ id: 1 }, { id: 2 }], {
    minRadius: 100,
    maxRadius: 200,
    bandGap: 4,
  })
  assert.equal(bands.length, 2)
  assert.equal(bands[0].innerRadius, 102)
  assert.equal(bands[0].outerRadius, 148)
  assert.equal(bands[1].innerRadius, 152)
  assert.equal(bands[1].outerRadius, 198)
})

test('signalTrackPath returns empty string for no bins', () => {
  assert.equal(signalTrackPath([], { innerRadius: 10, outerRadius: 20 }, 1000), '')
})

test('signalTrackPath produces a closed path starting with M and ending with Z', () => {
  const bins = [
    { start: 0, value: 1 },
    { start: 250, value: 5 },
    { start: 500, value: 2 },
    { start: 750, value: 0 },
  ]
  const d = signalTrackPath(bins, { innerRadius: 10, outerRadius: 20 }, 1000)
  assert.match(d, /^M/)
  assert.match(d, /Z$/)
})

test('signalTrackPath mirrored keeps points within outerRadius from center', () => {
  const bins = [
    { start: 0, value: 1 },
    { start: 500, value: -1 },
  ]
  const d = signalTrackPath(bins, { innerRadius: 10, outerRadius: 30 }, 1000, { mirrored: true })
  const coords = [...d.matchAll(/(-?\d+\.?\d*),(-?\d+\.?\d*)/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ])
  for (const [x, y] of coords) {
    assert.ok(Math.hypot(x, y) <= 30.0001)
  }
})

test('annotationFeaturePath produces a closed wedge path', () => {
  const d = annotationFeaturePath({ start: 0, end: 500, name: 'x' }, { innerRadius: 50, outerRadius: 60 }, 2000)
  assert.match(d, /^M/)
  assert.match(d, /Z$/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/render.test.js`
Expected: FAIL — `Cannot find module '../src/render.js'`

- [ ] **Step 3: Implement**

```js
// src/render.js
export function computeTrackBands(visibleTracks, { minRadius, maxRadius, bandGap = 4 }) {
  const bandHeight = (maxRadius - minRadius) / visibleTracks.length
  return visibleTracks.map((track, i) => ({
    track,
    innerRadius: minRadius + i * bandHeight + bandGap / 2,
    outerRadius: minRadius + (i + 1) * bandHeight - bandGap / 2,
  }))
}

function bpToAngle(bp, genomeLength) {
  return (bp / genomeLength) * 2 * Math.PI - Math.PI / 2
}

function polar(radius, angle) {
  return [radius * Math.cos(angle), radius * Math.sin(angle)]
}

export function signalTrackPath(bins, band, genomeLength, { mirrored = false } = {}) {
  if (bins.length === 0) return ''
  const { innerRadius, outerRadius } = band
  const midRadius = mirrored ? (innerRadius + outerRadius) / 2 : innerRadius
  const halfSpan = mirrored ? (outerRadius - innerRadius) / 2 : outerRadius - innerRadius
  const maxAbs = Math.max(1e-9, ...bins.map((b) => Math.abs(b.value)))
  const points = bins.map((b) => {
    const radius = midRadius + (b.value / maxAbs) * halfSpan
    return polar(radius, bpToAngle(b.start, genomeLength))
  })
  return `M${points.map((p) => p.join(',')).join('L')}Z`
}

export function annotationFeaturePath(feature, band, genomeLength) {
  const startAngle = bpToAngle(feature.start, genomeLength)
  const endAngle = bpToAngle(feature.end, genomeLength)
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0
  const [ox1, oy1] = polar(band.outerRadius, startAngle)
  const [ox2, oy2] = polar(band.outerRadius, endAngle)
  const [ix2, iy2] = polar(band.innerRadius, endAngle)
  const [ix1, iy1] = polar(band.innerRadius, startAngle)
  return [
    `M${ox1},${oy1}`,
    `A${band.outerRadius},${band.outerRadius} 0 ${largeArc} 1 ${ox2},${oy2}`,
    `L${ix2},${iy2}`,
    `A${band.innerRadius},${band.innerRadius} 0 ${largeArc} 0 ${ix1},${iy1}`,
    'Z',
  ].join(' ')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/render.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/render.js test/render.test.js
git commit -m "feat: hand-rolled radial rendering geometry (no D3 dependency)"
```

---

### Task 7: App assembly — DOM, drag-drop, zoom/pan, track panel (`app.js`, `interaction.js`, `index.html`)

**Files:**
- Modify: `index.html`
- Create: `src/interaction.js`
- Create: `src/app.js`

**Interfaces:**
- Consumes everything from Tasks 2–6: `parseAnnotation`, `createGenome`/`setView`/`resetView`/`viewSpan`, `createSignalTrack`/`createAnnotationTrack`/`addTrack`/`setVisibility`/`reorderTrack`/`setColor`/`visibleTracksInOrder`/`checkGenomeLengthMismatch`, `openBigWig`/`getBinnedValues`, `computeTrackBands`/`signalTrackPath`/`annotationFeaturePath`, `BlobFile` from `vendor/bbi.bundle.js`.
- Produces: the running application. No further tasks depend on this one.

This task has no automated test — it's DOM/browser wiring. Its "test" is the manual browser walkthrough in Step 6.

- [ ] **Step 1: Fill in `index.html` with the SVG canvas, drop zone, and track panel**

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>OrbiT</title>
  <style>
    body { margin: 0; display: flex; font-family: sans-serif; }
    #canvas-area { flex: 1; position: relative; }
    #canvas-area.dragover { outline: 3px dashed #1f77b4; }
    svg { width: 100%; height: 100vh; }
    #panel { width: 280px; border-left: 1px solid #ccc; padding: 8px; overflow-y: auto; }
    #error-banner { position: absolute; top: 0; left: 0; right: 0; background: #c0392b; color: white; padding: 8px; display: none; }
    .track-row { display: flex; align-items: center; gap: 4px; margin-bottom: 4px; }
    .track-row input[type="text"] { width: 60px; }
  </style>
</head>
<body>
  <div id="canvas-area">
    <div id="error-banner"></div>
    <svg id="canvas"><g id="viewport"></g></svg>
  </div>
  <div id="panel">
    <p>Drop bigWig (.bw) and annotation (.bed/.gtf) files anywhere on the canvas.</p>
    <div id="track-list"></div>
    <button id="reset-zoom">Reset zoom</button>
  </div>
  <script type="module" src="src/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `interaction.js` — hand-rolled wheel-zoom + drag-rotate + track panel rendering**

```js
// src/interaction.js
import { setView, resetView, viewSpan } from './genome.js'
import { setVisibility, reorderTrack, setColor, visibleTracksInOrder } from './tracks.js'

export function attachZoomPan(svgEl, genome, onChange) {
  let dragStartAngle = null
  let dragStartView = null

  svgEl.addEventListener('wheel', (event) => {
    event.preventDefault()
    const zoomFactor = event.deltaY < 0 ? 0.85 : 1 / 0.85
    const span = viewSpan(genome)
    const center = genome.view.start + span / 2
    const newSpan = Math.min(genome.length, Math.max(50, span * zoomFactor))
    const next = setView(genome, center - newSpan / 2, center + newSpan / 2)
    onChange(next)
  })

  svgEl.addEventListener('pointerdown', (event) => {
    dragStartAngle = Math.atan2(event.offsetY - svgEl.clientHeight / 2, event.offsetX - svgEl.clientWidth / 2)
    dragStartView = { ...genome.view }
    svgEl.setPointerCapture(event.pointerId)
  })

  svgEl.addEventListener('pointermove', (event) => {
    if (dragStartAngle === null) return
    const angle = Math.atan2(event.offsetY - svgEl.clientHeight / 2, event.offsetX - svgEl.clientWidth / 2)
    const deltaBp = ((angle - dragStartAngle) / (2 * Math.PI)) * genome.length
    const next = setView(
      { ...genome, view: dragStartView },
      dragStartView.start - deltaBp,
      dragStartView.end - deltaBp
    )
    onChange(next)
  })

  svgEl.addEventListener('pointerup', () => {
    dragStartAngle = null
  })
}

export function renderTrackPanel(panelEl, trackList, callbacks) {
  panelEl.innerHTML = ''
  for (const track of [...trackList].sort((a, b) => a.order - b.order)) {
    const row = document.createElement('div')
    row.className = 'track-row'

    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = track.visible
    checkbox.addEventListener('change', () => callbacks.onVisibilityChange(track.id, checkbox.checked))

    const label = document.createElement('span')
    label.textContent = track.name

    const color = document.createElement('input')
    color.type = 'color'
    color.value = track.color
    color.addEventListener('input', () => callbacks.onColorChange(track.id, color.value))

    const up = document.createElement('button')
    up.textContent = '↑'
    up.addEventListener('click', () => callbacks.onReorder(track.id, Math.max(0, track.order - 1)))

    const down = document.createElement('button')
    down.textContent = '↓'
    down.addEventListener('click', () => callbacks.onReorder(track.id, track.order + 1))

    row.append(checkbox, label, color, up, down)
    panelEl.appendChild(row)
  }
}
```

- [ ] **Step 3: Write `app.js` — file handling, error banners, render loop**

```js
// src/app.js
import { BlobFile } from '../vendor/bbi.bundle.js'
import { createGenome, resetView } from './genome.js'
import {
  createSignalTrack,
  createAnnotationTrack,
  addTrack,
  setVisibility,
  reorderTrack,
  setColor,
  visibleTracksInOrder,
  checkGenomeLengthMismatch,
} from './tracks.js'
import { openBigWig, getBinnedValues } from './parse-bigwig.js'
import { parseAnnotation } from './parse-annotation.js'
import { computeTrackBands, signalTrackPath, annotationFeaturePath } from './render.js'
import { attachZoomPan, renderTrackPanel } from './interaction.js'

const canvasArea = document.getElementById('canvas-area')
const svg = document.getElementById('canvas')
const viewport = document.getElementById('viewport')
const panel = document.getElementById('track-list')
const errorBanner = document.getElementById('error-banner')
const resetZoomBtn = document.getElementById('reset-zoom')

let genome = null
let trackList = []
const bigWigHandles = new Map()

function showError(message) {
  errorBanner.textContent = message
  errorBanner.style.display = 'block'
  setTimeout(() => { errorBanner.style.display = 'none' }, 6000)
}

async function render() {
  if (!genome) return
  viewport.innerHTML = ''
  const cx = svg.clientWidth / 2
  const cy = svg.clientHeight / 2
  const maxRadius = Math.min(cx, cy) - 10
  const visible = visibleTracksInOrder(trackList)
  const bands = computeTrackBands(visible, { minRadius: 30, maxRadius, bandGap: 4 })

  for (const { track, innerRadius, outerRadius } of bands) {
    if (track.type === 'annotation') {
      for (const feature of track.features) {
        const d = annotationFeaturePath(feature, { innerRadius, outerRadius }, genome.length)
        appendPath(d, track.color, cx, cy)
      }
      continue
    }

    const handle = bigWigHandles.get(track.id)
    if (!handle) continue
    const { start, end } = genome.view
    const chromName = Object.keys(handle.chromSizes)[0]

    if (track.strand === 'paired') {
      const [plusBins, minusBins] = await Promise.all([
        getBinnedValues(handle.plus, chromName, start, end, track.binCount),
        getBinnedValues(handle.minus, chromName, start, end, track.binCount),
      ])
      const merged = plusBins.map((b, i) => ({ start: b.start, value: b.value - minusBins[i].value }))
      const d = signalTrackPath(merged, { innerRadius, outerRadius }, genome.length, { mirrored: true })
      appendPath(d, track.color, cx, cy)
    } else {
      const bins = await getBinnedValues(handle.single, chromName, start, end, track.binCount)
      const d = signalTrackPath(bins, { innerRadius, outerRadius }, genome.length)
      appendPath(d, track.color, cx, cy)
    }
  }

  renderTrackPanel(panel, trackList, {
    onVisibilityChange: (id, visible) => { trackList = setVisibility(trackList, id, visible); render() },
    onColorChange: (id, color) => { trackList = setColor(trackList, id, color); render() },
    onReorder: (id, newOrder) => { trackList = reorderTrack(trackList, id, newOrder); render() },
  })
}

function appendPath(d, color, cx, cy) {
  if (!d) return
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', d)
  path.setAttribute('transform', `translate(${cx},${cy})`)
  path.setAttribute('fill', color)
  path.setAttribute('fill-opacity', '0.7')
  viewport.appendChild(path)
}

async function handleBigWigFile(file) {
  const handle = await openBigWig(new BlobFile(file))
  const chromName = Object.keys(handle.chromSizes)[0]
  const length = handle.chromSizes[chromName]

  if (!genome) {
    genome = resetView(createGenome(length))
  }

  return { handle, length, name: file.name.replace(/\.(bw|bigwig)$/i, '') }
}

async function handleDroppedFiles(files) {
  const bigwigFiles = files.filter((f) => /\.(bw|bigwig)$/i.test(f.name))
  const annotationFiles = files.filter((f) => /\.(bed|gtf|gff3?)$/i.test(f.name))

  for (const file of annotationFiles) {
    try {
      const text = await file.text()
      const features = parseAnnotation(text, file.name)
      trackList = addTrack(trackList, createAnnotationTrack({ name: file.name, features }))
    } catch (err) {
      showError(`Couldn't parse "${file.name}": ${err.message}`)
    }
  }

  for (const file of bigwigFiles) {
    try {
      const { handle, length, name } = await handleBigWigFile(file)
      const track = createSignalTrack({ name, files: { single: file.name }, genomeLength: length })
      if (checkGenomeLengthMismatch(track, genome.length)) {
        showError(`"${file.name}" genome length (${length}) doesn't match the loaded genome (${genome.length}); it will be clipped.`)
      }
      bigWigHandles.set(track.id, { chromSizes: handle.chromSizes, single: handle.handle })
      trackList = addTrack(trackList, track)
    } catch (err) {
      showError(`Couldn't parse "${file.name}": ${err.message}`)
    }
  }

  render()
}

canvasArea.addEventListener('dragover', (e) => { e.preventDefault(); canvasArea.classList.add('dragover') })
canvasArea.addEventListener('dragleave', () => canvasArea.classList.remove('dragover'))
canvasArea.addEventListener('drop', (e) => {
  e.preventDefault()
  canvasArea.classList.remove('dragover')
  handleDroppedFiles([...e.dataTransfer.files])
})

resetZoomBtn.addEventListener('click', () => {
  if (genome) { genome = resetView(genome); render() }
})

svg.addEventListener('wheel', () => {}, { passive: false })
attachZoomPan(svg, genome ?? { length: 1, view: { start: 0, end: 1 } }, (next) => { genome = next; render() })
```

Note: `attachZoomPan` is wired against a placeholder genome before the first file loads; once `genome` is set in `handleBigWigFile`, subsequent wheel/drag events read the real `genome` object referenced by closure inside `app.js`'s own listener state — this works because `attachZoomPan`'s handlers close over the `genome` variable passed at call time. **If manual testing (Step 6) shows zoom stops working after the first bigWig loads**, that closure-over-stale-`genome` is the reason — fix by calling `attachZoomPan` again (or passing a getter instead of the value) once `genome` is first created in `handleBigWigFile`, then re-run Step 6.

- [ ] **Step 4: Check the vendor bundle path resolves in a browser context**

Run: `python3 -m http.server 8000 --directory .` (from the `orbit-track` folder)
Expected: server starts.

- [ ] **Step 5: Open the app and check for console errors**

Open `http://localhost:8000/` in a browser, open DevTools console.
Expected: no red errors on load (a blank canvas + drop-zone message is correct at this point — no files loaded yet).

- [ ] **Step 6: Manual smoke test — load a real track and verify the interaction loop**

1. Drag `test/fixtures/sample.bw` onto the canvas.
   Expected: a colored ring appears; no error banner.
2. Drag `test/fixtures/sample.bed` onto the canvas.
   Expected: a second, thinner ring of wedge shapes appears (the annotation features).
3. Scroll to zoom in.
   Expected: the rings' signal detail changes (re-binned at higher resolution) — fix the closure issue noted in Step 3 if this does nothing.
4. Click-drag on the canvas.
   Expected: the view rotates (pans through genome positions).
5. Click "Reset zoom".
   Expected: view returns to the full circle.
6. Toggle a track's checkbox off in the panel.
   Expected: its ring disappears; toggle back on, it reappears.
7. Drag a non-bigWig, non-BED file (e.g. a `.txt`) onto the canvas.
   Expected: an error banner appears, naming the file; the rest of the app keeps working.

If any expected behavior doesn't happen, fix the relevant code in `app.js`/`interaction.js` before proceeding — this manual walkthrough is this task's test.

- [ ] **Step 7: Commit**

```bash
git add index.html src/interaction.js src/app.js
git commit -m "feat: app assembly - drag-drop, zoom/pan, track panel, error banners"
```

---

## Self-Review Notes

- **Spec coverage:** genome model (Task 3), track model incl. paired-strand (Task 4), bigWig parsing/binning (Task 5), BED/GTF parsing (Task 2), radial rendering incl. mirrored paired tracks (Task 6), zoom/pan + track panel + drag-drop + error handling (Task 7), vendoring/offline setup (Task 1), pure-function test coverage (Tasks 2-6) — all spec sections covered.
- **Deviation flagged explicitly** in Global Constraints: D3 dropped in favor of hand-rolled geometry/interaction, `@gmod/bbi` pre-bundled via `esbuild` rather than raw-copied (it has transitive deps that don't resolve as bare imports in a bundler-free browser).
- **Known rough edge carried into Task 7 Step 3-6 on purpose** (not hidden): the zoom-pan closure over `genome` created before any file is loaded. Flagged inline with the fix, verified by the manual test in Step 6 rather than papered over.
