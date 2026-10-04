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

To install from a clone rather than just run it, in PowerShell:

```powershell
npm install
npm run dist:win
& ".\release\ChartShift Setup 0.4.0.exe"   # use the version number it built
```

Needs Node.js 20 or newer.

Other scripts: `npm test` (unit tests), `node scripts/song-to-text.mjs <song.chartshift>` (prints the editable-text version of a saved song), `npm run shots` (captures screenshots of the main screens at several window sizes and scaling levels into `screenshots/`), `npm run smoke` (drives the real app in Electron against throwaway folders and checks library conflicts, recovery, the content security policy, navigation/IPC lock-down, keyboard and focus behaviour, mixed-size printing and OCR; `node scripts/check-smoke.mjs release/win-unpacked/ChartShift.exe` runs the same checks on a packaged build), `npm run sample` (regenerates `public/sample.pdf`), `npm run web` (editor in a browser, for development).

## What it does

- **Rearrange**: grab by section, block, line, word or letter; drag, nudge, resize, copy, erase; add text boxes; add, reorder and delete pages. Drag a selection onto another page to move it there (the view scrolls if you drag to its edge). Pages sit next to each other when the window is wide enough; the two-page button zooms to fit two across.
- **Scan cleanup** (automatic on scans and photos): straightens tilted pages, whitens grey or unevenly lit paper, drops specks. "Remove stray specks" catches leftovers.
- **Sections**: name a group of lines (Verse, Chorus…), then move it up/down, repeat it, or delete it and close the gap. "Find sections from headings" does this from the text: it recognises bracketed headings as used by Ultimate Guitar (`[Verse 1]`, `[Chorus]`, `[Guitar Solo]`, `[Chorus] x2`) as well as plain ones (`Verse 1`, `Chorus x2`, `Bridge:`). A scan needs "Read text from scan" first.
- **Chords**: transpose by half steps or to a key, capo shapes, Nashville numbers. Digital PDFs are read directly; scans use built-in OCR followed by a "Check the chords" review. **Rescan for chords** looks through the page again at any time and updates the list: it reads any text not yet read, finds chords that were missed (for example in a song saved by an older version), corrects misreads such as "Cc", and keeps the corrections you made by hand. The key is judged from all of a song's chords, not just the first.
- **Layout**: fit a song on one page, or large print.
- **ChordPro**: open `.cho`/`.chopro` files and export to `.cho`.
- **Library**: every song and setlist lives in one folder (`Documents\ChartShift Library` by default). Export/import the whole library as a zip, or keep the folder inside OneDrive/Google Drive/Dropbox to sync. Setlists save or print as one PDF.
- **Autosave**: unsaved work is parked 15 seconds after a change and offered back after a crash. Saving the song, opening another, or choosing to close without saving discards the parked copy.

## Writing a song

**New** (Ctrl+N) starts a song from a blank page; opening a ChordPro file (`.cho`) does the same with its contents. A written song is text, edited on the **Write** tab, and the page is laid out from it as you type.

- **Words and chords**: type the lyrics and put each chord in square brackets where it is played, `[G]Amazing [C]grace`. A line such as `Verse 1`, `Chorus` or `[Bridge]` on its own starts a section.
- **Song details**: title, writer, key, time signature, tempo and capo, shown under the title.
- **Chords in the key**: once a key is chosen, its seven chords appear as buttons with their numbers (1, 2m, 3m, 4, 5, 6m, 7°); a button puts the chord in at the cursor.
- **Syllable counts**: a rough count beside every line, for matching lines to each other. It is a guide, not a dictionary.
- **Song structure** (Sections tab): the sections as a list; move one earlier or later, repeat it, or delete it. This rewrites the text.
- **Columns**: one column, or two columns under the title, which fits about twice as much on a page. Lines too wide for a column are wrapped, each chord staying with its words.
- **Chord diagrams**: guitar or ukulele fingering boxes for the chords used, in a row under the title. Unusual chords are shown as the plainer chord of the same family (C7 for C9); chords with no shape (dim, aug) are left out.
- **Drafts**: keep a named copy of the words, and go back to it later. Drafts are saved inside the song. Going back keeps what you had as "Before restoring".
- **Transpose, capo and Nashville numbers** (Chords tab) rewrite the chords in the text.

You can still drag things on the page of a written song, but the page is laid out again the next time the text changes, which puts them back; ChartShift asks before doing that.

A chart opened from a PDF can be turned into a written song with **Turn this chart into editable text** on its Write tab, once its text has been read. This makes a new song from the recognised words and chord positions and leaves the chart as it was. The chart is read one column at a time, then page by page; each row of chords is folded into the lyric line beneath it (including when a long line was wrapped and its chords sit on two rows, or when the words continue at the top of the next column); the large first line becomes the title and page numbers are left out. A long song is set in two columns. Chords are put where the chart has them, so one that sits in the middle of a word stays there: check a few by eye.

## Chords from a recording (experimental)

This feature is marked **Experimental** in the app: it is new, and so far has only been tested on computer-generated strumming.

**Chords from a recording…** (More menu, Write tab, or the welcome screen) listens to an instrument and writes down the chords it hears.

- Record with the microphone, or choose an audio file (WAV, MP3, M4A, OGG, FLAC…; up to 15 minutes).
- The result shows each chord with the time it starts. Play the recording back and the current chord is highlighted; choose a chord to hear that part.
- The chords are also given as song text, a few to a line, which you can correct before using. Then add them to the end of the song you are writing, or start a new song with them (its key is filled in).

What to expect: it is a first draft, not a transcription.

- It works best with one guitar or piano playing chords clearly, with no singing and little background noise.
- It recognises plain major and minor chords. Sevenths and sus chords are written as the chord they are built on.
- It copes with an instrument tuned a little sharp or flat, and reports roughly how far.
- It does not hear words or individual notes, and it does not know where bars begin.
- So far it has only been tested on computer-generated strumming, not on real recordings.

Nothing is sent anywhere: the sound is analysed on the PC and is not kept after the window closes. The microphone is the only device ChartShift ever asks for, and only for this; the camera and everything else stay refused.

## Updating

**Check for updates…** (More menu) asks GitHub for the latest release. If there is a newer one it shows what is in it, downloads the installer, checks it, and then closes ChartShift and starts the installer. Songs in the library are kept.

- By default nothing is checked in the background: it only contacts github.com when you ask, and sends nothing about you or your songs.
- **Check for updates when ChartShift starts** (a tick box in that window, off unless you turn it on) asks GitHub once each time the app opens. If there is a newer version, an **Update available** button appears at the top. It never downloads or installs by itself, and stays silent when offline.
- The installer is only accepted from this project's own releases, and the download must match the size and SHA-256 digest GitHub lists for it; anything else is thrown away.
- The installer is not code-signed, so Windows still shows its "unknown publisher" warning.
- A copy run from source (`npm start`) can check and download, but will not install over itself; use `git pull`.

## When two PCs change a song

If the library folder is shared through OneDrive, Google Drive, Dropbox or similar, two people can edit the same song.

**What ChartShift guarantees, on each PC:** a save never removes a file's contents unless they are exactly the version that editor last opened or saved. Anything else found under the song's name is kept.

- Every time a song is opened or saved, ChartShift remembers that version (a fingerprint of the file's contents).
- On save, if the copy in the library is no longer that version, nothing is written. You are told the song was changed somewhere else and asked to choose:
  - **Save mine as a separate copy** - yours is saved as `Song (my copy <date time>)`; the other version is untouched. Both stay in the library.
  - **Save mine under this name** - the other version is first kept as `Song (conflict copy <date time>)`, then yours takes the song's name. Both stay in the library.
  - **Cancel** - nothing is saved yet.
- Saving a new song under a name that is already taken asks the same way. Here, choosing to replace moves the old song out of the library to the Recycle Bin; it can be restored from there until the bin is emptied.
- The check is repeated at the moment of writing. The file in the way is moved aside rather than overwritten, so a version that turns up *while* the save is in progress is also kept as a conflict copy.
- Copy names are always unique. If two copies are made in the same second the later one gets `#2`, `#3`…; an existing file is never overwritten.
- If ChartShift is interrupted mid-save (crash, power cut), a version that had been set aside reappears in the library as `Song (recovered copy …)`.

**What it cannot guarantee:** sync services copy files between PCs some time later and offer no shared lock. If two PCs both save the same song before they have synced, each save is correct on its own PC and the sync service then decides which copy keeps the name. Services normally keep the other one under their own name (for example `Song-PCNAME` or `Song (conflicted copy)`), which shows up in the library as a separate song - but that behaviour belongs to the service, not to ChartShift. Setlists are small files where the last save wins.

### Changing the library folder, and importing

Choosing a different library folder (or a cloud folder) copies your songs and setlists into it, and importing a library zip adds its songs. Both follow the same rule and report the counts afterwards:

- not in the destination: **copied**;
- already there with the same contents: counted as **already there and identical**;
- already there with different contents: **both are kept** - the incoming one is added as `Song (copy from previous folder <date time>)` or `Song (imported copy <date time>)`, and the names are listed.

Nothing in the destination is overwritten or skipped silently, and the previous folder is left as it was.

## Print preview

Print (Ctrl+P), for a song or a setlist, opens a preview first: every sheet is shown as it will be sent to the printer, with its paper size, and a note when a page is scaled or turned. Section outlines and chord underlines are editing aids and are not printed. Choose the paper there, then **Print…** opens the normal Windows print dialog. Margins or scaling picked in the printer's own dialog can still change the result.

When a song or setlist mixes page sizes or orientations, the preview says so and offers:

- **Fit every page onto one paper size** (the default for a mix) - each page is scaled to fit and centred on Letter, A4 or Legal; landscape pages are turned sideways on the sheet. Works with any printer.
- **Print each page at its own size** - each sheet keeps its page's size. This needs a printer (or a PDF printer) that can switch paper size within one job.

Saving as PDF always keeps each page's own size.

## Safety

- The window can only show the app's own pages (`app://chartshift`): navigation elsewhere, pop-ups and embedded web views are refused, and the pages are served with a strict Content Security Policy (no remote or inline script, no `eval`).
- Requests from the page to the main process (files, library, recovery, printing) are only honoured from the main window's own top-level page.
- Song files, imported libraries, PDFs and images are treated as untrusted: sizes and counts are limited, song contents are validated field by field, picture dimensions are checked before decoding, and names from zip files can never write outside the library folder. A file that fails a check is refused with a message; the song you have open is left alone.
- Limits (see `src/lib/songSchema.js`, `electron/safety.cjs`): files up to 300 MB, PDFs up to 100 pages and 50 inches per side, songs up to 200 pages, library zips up to 1 GB / 2000 items.

## How it works

- `src/lib/segment.js` – finds every blob of ink on a rendered page, cuts each out as a transparent sprite, and groups sprites into letters, words, lines and blocks. Staffs and tab systems become one block that carries whatever sits inside it.
- `src/lib/cleanup.js` – background flattening and tilt measurement for scans.
- `src/lib/importer.js` – renders PDF pages (pdf.js) or images at 300 dpi, cleans scans, segments, and attaches the PDF's own text.
- `src/lib/textlayer.js`, `src/lib/ocr.js` – match recognised words (PDF text or Tesseract OCR) to pieces and mark chords.
- `src/lib/chords.js`, `src/lib/chordpro.js`, `src/lib/layout.js` – chord maths, ChordPro, fit/enlarge.
- `src/editor/` – `store.js` (pages, selection, tools, undo), `sections.js`, `music.js`, `writing.js` (written songs: text in, pages out).
- `src/lib/audioChords.js` (chords from sound: note strengths per moment, matched to chord patterns, smoothed over time), `src/lib/audioInput.js` (decoding and microphone), `src/ListenDialog.jsx`.
- `src/lib/songtext.js` (song text: structure, syllables, transposing), `src/lib/diagrams.js` (chord shapes, each checked by a test against the notes it should sound), `src/WriteTab.jsx`.
- `src/App.jsx` (shell: title bar, editing toolbar, welcome screen), `src/PageView.jsx` (one page), `src/Inspector.jsx` (Sections / Chords / Page tabs), `src/dialogs.jsx`, `src/ui.jsx` (shared controls), `src/icons.jsx`, `src/styles.css` (design tokens) – the UI.
- `src/lib/exporter.js` – flattens pages at 300 dpi into a PDF (pdf-lib) or into images for printing.
- `src/lib/project.js` – `.chartshift` song files (a zip of `song.json` + sprite sheets), so songs stay editable.
- `electron/main.cjs`, `electron/library.cjs` – window, dialogs, printing, the library folder, crash recovery.
- `electron/update.cjs` – finding, downloading and checking an update from GitHub releases.
- `electron/songStore.cjs` – the file operations behind saving, conflict copies, folder moves and imports. `electron/harness.cjs` – the smoke and screenshot runs.
- `electron/safety.cjs`, `src/lib/songSchema.js`, `src/lib/recoveryQueue.js`, `src/lib/printPlan.js` – the safety rules: trusted origins, path containment, file limits and validation, save-conflict decisions, autosave ordering, print sheet planning. All pure and unit-tested.

## Shortcuts

| Keys | Action |
|---|---|
| V / T / E | Move, Text box, Eraser tool |
| 1 – 5 | Select by section, block, line, word, letter |
| . / , | Select the next / previous piece (keyboard-only editing) |
| Arrow keys (Shift = 10x) | Nudge selection |
| Shift-drag / Alt-drag | Move in a straight line / move without snapping |
| Ctrl+C / X / V / D | Copy, cut, paste, duplicate |
| Ctrl+Z / Ctrl+Y | Undo, redo |
| Ctrl+N | New song |
| Ctrl+O / L / S / E / P | Open, library, save (Ctrl+Shift+S: save under a new name), save as PDF, print |
