# Linear view in OrbiT

Date: 2026-10-09

## Goal
Reading PRO-seq around a ring is hard to place. Add a straight, horizontal view of the same data, toggled with one key, so strand-specific signal reads like IGV/ProBrow. Circular stays the default. Browser-only, no new dependencies.

## Decisions (approved in chat 2026-10-09)
- Toggle: **Circular / Linear** header button and `v` key. Mode is saved in sessions.
- Linear uses the existing genome view (`view.start`, `view.span`), so switching keeps position.
- Full linear view is locked to start at bp 1 (no rotating). Panning works once zoomed.
- Overlay groups share one band, as in the circle.
- Out of scope: search box / gene jump, multiple chromosomes in one view, new file formats.

## 1. Layout
- Ruler along the top with ticks and labels. A window crossing the origin reads continuously; labels wrap back to 1.
- Origin: vertical accent line at bp 1 when inside the window.
- Tracks stack vertically (same order and `weight` as the rings). A left gutter holds the track name and Y range.
- Paired PRO-seq tracks are mirrored about a centre axis: plus above, minus below, track colours. Unstranded signal draws upward from the baseline.
- Annotation tracks draw lanes (`packLanes`) with strand arrows and names when they fit.
- Minimap: thin full-genome strip with the current window as a box; click or drag moves the window.

## 2. Code
- `src/linear.js` (pure): `xOf(rel, span, width)`, `relAtX`, `computeLinearBands(tracks, {top, bottom, gap})`, `signalPathLinear(bins, band, viewStart, span, scale, width)`, wrap handling for windows crossing the origin.
- `src/draw-linear.js`: `drawLinear(root, { width, height, genome, tracks, data, theme, ySettings })`, returns a scene with `bands` and `minimap` for hit-testing. Reuses scale logic (`computeScale`, shared/locked Y, factor) and annotation hit records.
- `src/interaction.js`: add `attachLinearZoomPan` (wheel zooms at cursor x, drag pans horizontally, double-click zooms in, Shift out).
- `src/app.js`: `mode` state; `render()` picks the drawer; `locate`/`describe` get a linear variant; interaction handlers swapped on toggle. `fetchSignal` is unchanged except `autoBins` is derived from canvas width in linear mode.
- `src/session.js`: save and restore `mode`.
- Shared helpers (`el`, `text`, `fmtVal`) are exported from `draw.js` rather than duplicated.

## 3. Behaviour details
- Wrap: a window with `start + span > length` is drawn as one continuous x range; positions beyond `length` display mod length.
- Full view: `start = 0`, `span = length`; pan input ignored. Zooming in then allows panning.
- Hover readout, tooltip, shared Y, lock, smooth/sharpen, global bar and track cards behave as in the circle.
- Annotation names: drawn inside features when they fit, otherwise only in the cursor readout.

## 4. Testing
- `test/linear.test.js` (`node --test`): x mapping at window edges, wrap across origin, band stacking, mirrored path symmetry, empty data.
- Manual browser check (no automated browser available): load `chrM.plus.bw`, `chrM.minus.bw`, `sample.bed`; toggle `v`; zoom, pan, wrap the origin, click the minimap strip, export SVG.

## Risks
- `app.js` is 450+ lines and gains mode switching. If it grows past about 550 lines, split hover/click into `src/hover.js` as part of the same work.
