# OrbiT

Interactive viewer for small circular genomes (mitochondria first), built around strand-specific PRO-seq style signal. It has a circular view and a linear view of the same data. Everything runs locally in your browser: no upload, no backend.

## Install and run

**You need**
- A modern browser (Chrome, Edge, Firefox or Safari).
- Python 3 (any recent version), only to serve the files locally. Check with `python3 --version`. On Windows the command is `python --version`; install from [python.org](https://www.python.org/downloads/) if it is missing.
- Git, only if you want to clone. Check with `git --version`. Otherwise use the ZIP download below.

**1. Get the code** (pick one)

With git:
```
git clone https://github.com/SerhatAktay/OrbiT.git
cd OrbiT
```

Without git: on the [repo page](https://github.com/SerhatAktay/OrbiT) click **Code → Download ZIP**, unzip it, and open a terminal in the unzipped `OrbiT` folder.

**2. Start the server**
```
python3 scripts/serve.py        # Windows: python scripts/serve.py
```
This opens OrbiT in your default browser (<http://localhost:8765>). If it does not, open that address yourself. The terminal keeps running while the server is up; leave it open. `npm start` does the same.

**3. Stop** with `Ctrl+C` in the terminal.

**Update later:** `git pull` in the `OrbiT` folder (or download the ZIP again), then restart the server.

`index.html` does not work if you double-click it (`file://`), because browsers block ES modules there. Always go through `http://localhost:8765`.

**Troubleshooting**
- *Port 8765 already in use* (`Address already in use`): an old server is still running. On macOS/Linux run `lsof -ti tcp:8765 | xargs kill`, or start on another port with `python3 scripts/serve.py 8800` and open `http://localhost:8800`.
- *Blank page or stale UI:* hard-reload (`Cmd+Shift+R` or `Ctrl+Shift+R`).
- *`python3: command not found`:* try `python` or `py`, or install Python.

## Load data

Drop files on the page, or click **Open files…**. You can mix types.

- **bigWig** (`.bw`). Name a strand pair `x.plus.bw` + `x.minus.bw` (also `pos/neg`, `fwd/rev`, `fw/rv`) and they merge into one mirrored track: plus above the baseline, minus below, two colours.
- **Annotation** (`.bed`, `.gtf`, `.gff`, `.gff3`, `.gb`/`.gbk`/`.gbff`). GenBank joins that cross the origin stay one feature. Overlaps get separate lanes, arrows show strand, names appear when they fit.

Chromosome names `chrM`, `MT` and `M` count as the same. If a bigWig has several chromosomes, a selector appears in the header.

Small test files (`chrM.plus.bw`, `chrM.minus.bw`, `sample.bed`) are in [`test/fixtures/`](../../tree/dev/test/fixtures) on the `dev` branch.

## Find your way around

- **Circular view** (default). The origin (bp 1) is marked at 12 o'clock and bp increases clockwise (hint in the centre). A live readout shows the position under the cursor, with the gene name when over one. When zoomed, a minimap at top left shows the current window as a highlighted arc; click it to jump.
- **Linear view**. Press `v` or use the header toggle. Ruler on top, tracks stacked below, strand pairs mirrored about a centre line. Position is kept when you switch views.

| Action | Effect |
| --- | --- |
| Scroll | zoom at cursor |
| Drag | rotate (circular) or pan (linear) |
| Double-click (Shift) | zoom in (out) |
| Click a feature | zoom to it |
| Hover | position, feature, or signal value |
| `v` | switch circular / linear |
| `R` | reset view |
| `?` | list all shortcuts |

## Signal controls

The bar at the top of the side panel applies to all signal tracks:

| Control | Key | What it does |
| --- | --- | --- |
| smooth | `s` / `S` | smoothing window in bp, peak-preserving. Off by default. |
| sharpen | `k` / `K` | adds fine detail back on top of the smoothing |
| shared Y | `p` | one Y range for all tracks |
| lock | `a` / `A` | freeze Y while you move around |
| Y− / Y+ | `[` / `]` | shrink / grow the Y range |
| bins | `b` / `B` | fewer / more bins. Default is automatic: one bin per nucleotide when the window is 4 kb or less, otherwise about one bin per 2 screen pixels. |

Signal is drawn as one flat bar per bin, with no interpolation between bins. Strand pairs use a symmetric Y range by default.

Each track card has visibility, colour, order (drag the `⠿` handle or use ↑/↓) and ring thickness. Per-track Y min/max, bin count and smoothing are under **Advanced**.

## Export and sessions

- **SVG**, **PNG** (3x), or **HTML**: a single self-contained file with the current view inlined, easy to share.
- **Save session / Load session** stores the view and track settings as JSON (not the data). Load the session, then open the same data files; tracks are matched by name, in either order.

## Known limits

- Checked in desktop Chromium only. Other browsers should work but are untested.
- The auto Y range follows the tallest bin, so one spike can flatten the rest. Use Y−/Y+ or a fixed range.

## Development

Tests, specs and build scripts live on the [`dev` branch](../../tree/dev).

## Feedback

When something looks wrong, a screenshot plus the file type and approximate window (for example `chrM 7,900–8,100`) helps most.
