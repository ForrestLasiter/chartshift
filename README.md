# ChartShift

Rearrange chord charts, tabs and sheet music. Open a PDF (scanned or digital) or a photo, and every line, word and letter becomes a piece you can drag, erase, copy or resize. Add text boxes, then save as a PDF or print.

Windows desktop app (Electron + React). Works fully offline.

## Run it

```bash
npm install
npm run dev        # app with live reload
npm start          # production build in Electron
npm run dist:win   # installer -> release/ChartShift Setup <version>.exe
```

Other scripts: `npm test` (piece-detection unit tests), `npm run smoke` (opens the sample chart in Electron and writes `smoke.png`), `npm run sample` (regenerates `public/sample.pdf`), `npm run web` (editor in a browser, for development).

## What it does

- **Rearrange**: grab by section, block, line, word or letter; drag, nudge, resize, copy, erase; add text boxes; add, reorder and delete pages.
- **Scan cleanup** (automatic on scans and photos): straightens tilted pages, whitens grey or unevenly lit paper, drops specks. "Remove stray specks" catches leftovers.
- **Sections**: name a group of lines (Verse, Chorus…), then move it up/down, repeat it, or delete it and close the gap. "Find sections from headings" does this from the text.
- **Chords**: transpose by half steps or to a key, capo shapes, Nashville numbers. Digital PDFs are read directly; scans use built-in OCR followed by a "Check the chords" review.
- **Layout**: fit a song on one page, or large print.
- **ChordPro**: open `.cho`/`.chopro` files and export to `.cho`.
- **Library**: every song and setlist lives in one folder (`Documents\ChartShift Library` by default). Export/import the whole library as a zip, or keep the folder inside OneDrive/Google Drive/Dropbox to sync. Setlists save or print as one PDF.
- **Autosave**: unsaved work is parked every 15 seconds and offered back after a crash.

## How it works

- `src/lib/segment.js` – finds every blob of ink on a rendered page, cuts each out as a transparent sprite, and groups sprites into letters, words, lines and blocks. Staffs and tab systems become one block that carries whatever sits inside it.
- `src/lib/cleanup.js` – background flattening and tilt measurement for scans.
- `src/lib/importer.js` – renders PDF pages (pdf.js) or images at 300 dpi, cleans scans, segments, and attaches the PDF's own text.
- `src/lib/textlayer.js`, `src/lib/ocr.js` – match recognised words (PDF text or Tesseract OCR) to pieces and mark chords.
- `src/lib/chords.js`, `src/lib/chordpro.js`, `src/lib/layout.js` – chord maths, ChordPro, fit/enlarge.
- `src/editor/` – `store.js` (pages, selection, tools, undo), `sections.js`, `music.js`.
- `src/PageView.jsx`, `src/Sidebar.jsx`, `src/dialogs.jsx`, `src/App.jsx` – the UI.
- `src/lib/exporter.js` – flattens pages at 300 dpi into a PDF (pdf-lib) or into images for printing.
- `src/lib/project.js` – `.chartshift` song files (a zip of `song.json` + sprite sheets), so songs stay editable.
- `electron/main.cjs`, `electron/library.cjs` – window, dialogs, printing, the library folder, crash recovery.

## Shortcuts

| Keys | Action |
|---|---|
| V / T / E | Move, Text box, Eraser tool |
| 1 – 5 | Grab by section, block, line, word, letter |
| . / , | Select the next / previous piece (keyboard-only editing) |
| Arrow keys (Shift = 10x) | Nudge selection |
| Shift-drag / Alt-drag | Move in a straight line / move without snapping |
| Ctrl+C / X / V / D | Copy, cut, paste, duplicate |
| Ctrl+Z / Ctrl+Y | Undo, redo |
| Ctrl+O / L / S / E / P | Open file, library, save song, save as PDF, print |
