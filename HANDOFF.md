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
| hymn (76) | 76 | 76 | 75 | **72** (2 extra) | **70** (5 extra) |
| melody (46) | 46 | 46 | 46 (2 extra) | 45 (2 extra) | 44 (3 extra) |

An owner-provided page photo was inspected locally with `scripts/render-song.mjs`, `scripts/omr-bars.mjs` and `scripts/omr-debug.mjs`. Both systems were found, with treble/bass clefs, A-flat (four flats) and 3/4. The first line's melody reads correctly (Eb F | Ab C Ab | C Bb | Ab F | Eb … | Ab C Ab | C Bb | Eb). The bass staff and the second system remain rougher and need a verified transcription before pitch tuning. Do not commit the photo or any render derived from it.

### Fixed after 0.8.0 (2026-10-19, uncommitted)

On the real photo, checked bar by bar against the page:
- An outlined head on a line (a diamond on a ledger line) was split by the line into two holes, and the upper one read a step high (phantom D-flat). Two holes one above the other, separated only by the line's own thickness and with a line between them, are now one head.
- Pieces of a head cut apart where a line was erased are joined back together (only pieces under 0.6 space tall, so two notes a third apart stay separate).
- The blend along a hand shadow's hard edge was read as ink, gluing heads to a dotted streak. Where the paper level jumps by more than 30 within two pixels, ink is now judged against the darker side.
- On photos only, a blob too big for a head has thin tails trimmed before it is judged.

First line of the photo, treble: every bar right except bar 5's hollow triangle (A-flat, touching the shadow's edge) and the alto half note in bar 6. Bass: improved but not yet checked against a full transcription.

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

## Chord chart lyric OCR (0.10.0)

0.9.0 added **Make a chord chart** (`src/lib/lyrics.js`, `makeChordChart` in `src/App.jsx`). On Forrest's photo (`Documents\ChartShift Library\IMG_4063.chartshift`) the app's chart drops or mangles words near the hand shadow's edge: "taught" missing, "grace" read as "pce", "I first" as "T fist", "lost" as "lst", "less days" missing.

What was found:
- The app's OCR (tesseract.js in the browser, `public/tesseract` wasm) reads differently from tesseract.js under Node, so `scripts/chart-debug.mjs` did NOT reproduce the problem. To reproduce for real: copy the song into `public/` (e.g. `public/zz-test-song.chartshift`, **delete it afterwards, never commit it**), start the Vite dev server (`npm run dev`, port 5183), open `http://localhost:5183/?debug`, then in the console: `await window.__openFile('IMG_4063.chartshift', new Uint8Array(await (await fetch('/zz-test-song.chartshift')).arrayBuffer()))`, then More menu → Read sheet music… → Make a chord chart, and read `__editor.getState().write.text`.
- Reading the whole page made the OCR lose its way among the staffs and notes.
- The cleaned image (`cleanedForReading` in `src/lib/omr.js`) looked intact around "taught" when inspected, so the remaining losses are in what the OCR returns for words crossing the shadow's edge, not (visibly) in the clean-up.

Changes in 0.10.0:
- `lyricBands(music)` in `src/lib/lyrics.js`: the band of words between each system's staffs. The app and `scripts/chart-debug.mjs` now OCR only those bands, each as one block of text (`recognise(canvas, scale, { block: true })`, page-segmentation mode 6), with word coordinates and OCR line ids offset back to the page.
- `src/lib/ocr.js`: full-page reading now always uses mode 3 (automatic); `readWord` and `readSyllable` restore mode 3 afterwards (they used to leave the engine in mode 6, so a later page read depended on what ran before).
- Where the cleaned lyric band differs substantially from the source photo, the app compares an enlarged OCR pass on the original photo. Confident words fill clear gaps; uncertain disagreements keep the cleaned read.
- The close-up retry is limited to one- and two-letter words and skips a word already present in that verse. When multiple chords land before the first lyric syllable, only the last is shown there to avoid a pickup chord stacking with the following chord.

Verification: `npm test` (124/124) and `npm run smoke` pass. The smoke test uses a clean engraved hymn; it does not verify the owner's photographed page. OCR output from the photographed page should still be checked by eye, particularly at the shadow edge and around pickup notes. The last in-app inspection was interrupted before this release's final OCR changes could be checked on that page.

## 2026-10-24: proven tools tested; words now read with PaddleOCR (uncommitted)

Forrest asked for a proven approach after the chord chart still failed at church. Tested on the engraved pages (`node scripts/omr-bench.mjs <folder> --homr <path>`, scores bar by bar against the truth) and on his real photos:

- **Notes (OMR):** homr 0.7.0 (camera-photo OMR, AGPL-3.0, Python) scored 95.9% on the engraved set against ChartShift's own reader's 98.0% (ours is tuned to that set). On his shape-note photo, every disputed bar checked against the photo was right in ours and wrong in homr (its errors were on diamonds and triangles). Decision: keep our reader for notes. homr's AGPL licence would also be a problem to bundle.
- **Words (OCR):** Tesseract was the real failure. PaddleOCR's PP-OCRv6 small models (Apache 2.0, ONNX, from RapidOCR) read his shadowed photo almost perfectly. Ported: `src/lib/paddleocr.js` (text finding with slant-following crops, CTC decoding with per-letter positions), `src/lib/wordReader.js` (onnxruntime-web/wasm in the app, models in `public/paddleocr`, wasm copied to `public/ort` by `npm run assets`). `makeChordChart` now uses it on the raw word bands; Tesseract is still used for chord charts' "Read text from scan".
- Remaining small misses on his photo: "I" at the start of "I once was lost", a stray "s" in "That s saved", "first" in the last line.
