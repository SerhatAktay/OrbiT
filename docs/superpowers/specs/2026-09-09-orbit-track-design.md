# OrbiT — Circular Genome Track Viewer

Date: 2026-09-09

## Problem

Existing circular genome viewers (Circos, pyCirclize, etc.) become messy and
hard to read for mitochondrial bigWig track data: too many stacked rings,
fixed non-interactive scale (can't zoom into a region like the D-loop
without regenerating the whole plot), and noisy/jagged signal rendering,
especially with stranded (plus/minus) data.

## Goal

A local, interactive, browser-based circular track viewer purpose-built for
small circular genomes (mitochondria first). Load bigWig signal tracks and
a BED/GTF annotation file, then declutter interactively: zoom into an
angular region, toggle/reorder/recolor tracks, and see clean signal
rendering at a resolution matched to the current zoom level.

## Non-goals

- Multi-chromosome / nuclear genome support (single circular chromosome only).
- Server backend (all parsing happens client-side in the browser).
- Session persistence / save-load (browser File objects can't be restored
  across reloads anyway).
- Publication-quality static export (PNG/SVG snapshot) — not requested.

## Architecture

Plain HTML + vanilla JS (ES modules). No build step, no bundler. Two
third-party libraries, vendored as static files under `vendor/` so the app
works fully offline once set up:

- **D3** — radial rendering primitives (`d3.lineRadial`, `d3.arc`) and
  `d3-zoom` for scroll/drag interaction.
- **`@gmod/bbi`** — client-side bigWig/BigBed parsing (reads local `File`
  objects directly, no server round-trip).

## Components

- `genome.js` — genome model: length (auto-detected from the first loaded
  bigWig's chrom-size header; assumed single circular chromosome), and the
  current view window (full circle, or a zoomed angular arc as
  `[startBp, endBp]`).
- `tracks.js` — track model:
  ```
  {
    id, name, type: 'signal' | 'annotation',
    strand: 'unstranded' | 'paired',
    files,          // 1 file (unstranded/annotation) or {plus, minus} (paired)
    color, visible, order,
    yScale: { mode: 'auto' | 'manual', min, max },
    binCount
  }
  ```
  A paired track renders as one ring: plus-strand signal drawn outward from
  a mid-radius baseline, minus-strand drawn inward from the same baseline.
- `parse-bigwig.js` — wraps `@gmod/bbi`: reads the header on file load,
  fetches binned summary values for the current view window at a
  resolution derived from `binCount` and zoom level (fewer bins zoomed out,
  more bins when zoomed into a small region — this is what keeps signal
  readable instead of jagged/noisy).
- `parse-annotation.js` — small pure-function parser for BED and GTF
  (name, start, end, strand per feature). No external library — these are
  simple line-oriented text formats.
- `render.js` — D3 radial rendering. Each visible track occupies one radius
  band (`[innerRadius, outerRadius]`), ordered by `track.order`. Signal
  tracks: `d3.lineRadial` filled area. Annotation tracks: `d3.arc` per
  feature, labeled where space allows.
- `interaction.js` — `d3-zoom` bound to the SVG: scroll wheel zooms into an
  angular arc (updates `genome.js`'s view window and triggers re-fetch),
  drag rotates the view. A side panel lists tracks with visibility toggle,
  drag-to-reorder, color picker, y-scale min/max inputs, and a bin-count
  slider.
- `app.js` — wires the above together: drag-and-drop zone for bigWig/BED
  files, error banner, re-render orchestration on any state change.

## Data flow

1. User drags in one or more bigWig files (and optionally a BED/GTF).
2. Each bigWig's header is read immediately; the first file's chrom size
   sets the genome length for the whole session.
3. A new track is added to the track list in `tracks.js` and rendered at
   the current view window / bin resolution.
4. Any zoom, pan, or track-list change (visibility, order, color, y-scale,
   bin count) triggers a re-fetch of binned values for affected tracks at
   the current resolution, then a re-render.

## Error handling

- File that isn't a valid bigWig/BED/GTF: inline error message near the
  drop zone; rest of the app keeps working.
- A later-loaded track's chrom size doesn't match the established genome
  length: warning banner, the first-loaded genome length remains
  authoritative, the mismatched track's data outside that range is
  clipped.
- Empty/no-data region in a bigWig: rendered as a flat baseline, not an
  error.

## Testing

Binning and parsing logic lives in pure functions (`parse-bigwig.js`,
`parse-annotation.js`) so it's testable without a DOM or a browser. One
`node --test` file, `test/parse.test.js`, exercises these against a small
fixture bigWig and a small fixture BED — no test framework, no fixtures
directory beyond the one small file each.

## Setup

`vendor/` is populated once via `npm install` (dev-time only, to fetch
`d3` and `@gmod/bbi`) followed by a copy step into `vendor/*.js`; the
`node_modules`/`package.json` used for that are not needed to actually run
the app afterward — opening `index.html` (or serving the folder statically
for module-loading reasons) is enough.
