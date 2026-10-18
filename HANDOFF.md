# Hand-off: sheet music reader, photographed and shape-note pages

State as of 2026-10-18. Released: 0.7.0 (sheet music reader for clean printed and scanned music). This change adds support for phone photos of hymnals and shape-note books.

## Why

Forrest photographed "Amazing Grace" from a shape-note hymnal (William Walker, Christian Harmony style: seven head shapes). 0.7.0 said "No music was found". Causes found:

1. A hand's shadow across the page: the single global ink threshold made the shadow into ink.
2. The page bows (book photo): staff lines are slightly curved, so whole-width line finding and line removal failed at the ends.
3. Shaped heads (triangle, half-moon, diamond, right triangle, oval, square, cone): the old head finders only knew ovals (solid core, or oval hole).
4. Several knock-ons: clefs touching the system line, the 4th flat touching the time signature, long chord stems taken for bar lines, the soprano and alto sharing one stem.

## What changed

All in `src/lib/omr.js` unless noted:

- **Ink against local paper**: `paperOf` (a morphological closing via `sweep`) gives the paper level around each pixel; `inkAgainst` marks ink only when clearly darker than that. Used when more than 3% of the page is not near-white (`uneven`).
- **Unbending**: `bendOf` finds staffs in vertical strips (each strip tried at slopes from -0.06 to 0.06, sharpest profile wins), picks the strongest run of five lines per staff, follows each staff from a middle strip outwards (step allowed grows with distance), drops points that disagree with their neighbours, extrapolates past the ends along the end slope, and ignores bends under max(2px, 0.15 space). `unbent` resamples; two passes. `toPage` maps back.
- Staff ends traced outwards along the five lines (crowded headers hid them).
- Lines longer than 6.5 spaces (system lines, brackets) are erased from `sym` before symbols are found.
- **Heads of any shape**: stems found as upright runs of 2.4 spaces or more and removed (`bare`); every head-sized blob joined to a stem (same ink component) is a head; whole notes need a wide outline. Letters are rejected by checking the side away from the stem is clear (a third of the height or more). Every head is then re-centred on its own outline. Overlapping finds keep the most trustworthy (`rank`).
- **Pitch** from the lines measured beside each note (`linesNear`, `stepAt`).
- Bar lines must stand alone (not joined to a head), and found stems are excluded; clef must mostly sit on its own staff; key signature skips small bits and things well off the staff; time signature accepts smudged-together figures; systems are joined by a line that may lean (photo turned).
- `src/lib/sheet.js`: two parts on a staff only when they have separate stems (`stemX`); maj7 made harder to suggest.
- Tests and tools: `test/helpers/engrave.mjs` gained `shapes` (seven-shape heads drawn over Verovio's output by scale step) and `photo` (bow, tilt, shadow band). `test/helpers/png.mjs` reads and writes PNGs. New scripts: `scripts/omr-score.mjs` (score table), `scripts/omr-bars.mjs` (bar-by-bar readout of a picture), `scripts/render-song.mjs` (draw a saved `.chartshift` page as PNG, as the app sees it). Two new tests in `test/sheetmusic.test.mjs` (photo floors, shape-note floors).

## Where it stands

`node scripts/omr-score.mjs`:

| piece | clean | scan | photo | shapes | shapes+photo |
|---|---|---|---|---|---|
| waltz (18) | 18 | 18 | 18 | **18** | 18 |
| hymn (76) | 76 | 76 | 75 | **72** (2 extra) | **69** (6 extra) |
| melody (46) | 46 | 46 | 46 (2 extra) | 45 (2 extra) | 44 (3 extra) |

An owner-provided page photo was inspected locally with `scripts/render-song.mjs`, `scripts/omr-bars.mjs` and `scripts/omr-debug.mjs`. Both systems were found, with treble/bass clefs, A-flat (four flats) and 3/4. The first line's melody reads correctly (Eb F | Ab C Ab | C Bb | Ab F | Eb … | Ab C Ab | C Bb | Eb). The bass staff and the second system remain rougher and need a verified transcription before pitch tuning. Do not commit the photo or any render derived from it.

## Next steps

1. Synthetic shape-note scoring is improved by widening the small diamond and square glyphs in `test/helpers/engrave.mjs`; pitch still comes from staff position. Clean, scan and photo scores are unchanged.
2. The real photo has been inspected, but bass and second-system accuracy still need comparison against a verified transcription.
3. `readMusic` takes about 1.7 s on a 3300×2550 page; consider a Web Worker if pages feel slow in the app.
4. README now documents photo and shape-note support and its limits. `node scripts/omr-score.mjs` and `npm test` pass.

## Rules for this repo

- Plain JavaScript (ESM; Electron files are `.cjs`), React 19, Vite. No new runtime dependencies; test-only packages go in devDependencies.
- `src/lib/*.js` must stay free of Node APIs (`process`, `fs`): they run in the browser. A stray `process.env` debug line would crash the app.
- UI must meet WCAG 2.1 AA.
- Don't commit, push or release until Forrest says so. Release recipe and gotchas: see the `chartshift` notes he keeps.
- Test windows (smoke, screenshots) open on his second monitor without focus; never on the primary screen.
