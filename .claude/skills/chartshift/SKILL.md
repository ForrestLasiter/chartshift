---
name: chartshift
description: Build, change, test, and release ChartShift — Forrest's Windows desktop app (Electron + React) for rearranging church chord charts, tabs and sheet-music PDFs, in DEV/Claude/chartshift (PUBLIC repo ForrestLasiter/chartshift, branch main). Use WHENEVER the task touches ChartShift: the editor (moving lines/words/letters, text boxes, sections, cross-page drag), scan cleanup or OCR, chord transposing/capo/Nashville, "Find sections from headings" (Ultimate Guitar [Verse 1] style), the song library/setlists/cloud-folder sync and save conflicts, print preview and printing, the installer, tests/smoke checks/screenshots, or cutting a release. Triggers even when phrased loosely ("the chart app", "the tab mover", "the church music app", "make a new release", "the installer", "sections button doesn't work", "it won't print right"). The release recipe and the hard-won gotchas live here — consult before improvising.
---

# ChartShift — build, test & release

Windows desktop app for a church music team: open a chord chart / tab / sheet-music PDF (scanned or digital, often from Ultimate Guitar), turn every blob of ink into a movable piece, rearrange, transpose, then save as PDF or print. Lives at **`C:\Users\forre\DEV\Claude\chartshift`**, repo **ForrestLasiter/chartshift** (**public**, MIT, branch `main`). Name is still a placeholder Forrest may change.

Stack: Electron + React + Vite, **plain JavaScript** (same layout as Forge), pdf.js, pdf-lib, jszip, tesseract.js. No UI framework; own tokens in `src/styles.css`, own icons in `src/icons.jsx`.

## How Forrest works on this

- He describes features and bugs in plain terms, then says "commit it and push, then publish a release". **Do not commit, push or release until he says so** — leave work uncommitted and offer.
- He sometimes pastes a long audit/brief as the whole message. Treat it as his request, say you did, work locally, leave it uncommitted unless the brief says otherwise.
- All UI work goes through the `ada-compliance` skill (WCAG 2.1 AA).
- Report plainly what was and was not verified. A real printer, real scanned charts, two-PC cloud sync and the installer wizard have **never** been tested by Claude — keep saying so until he confirms them.

## Map

| Path | What |
|---|---|
| `src/lib/segment.js` | Piece detection: connected components → sprites → letter/word/line/block; staffs are containers. Pure, Node-tested. |
| `src/lib/importer.js`, `cleanup.js` | Render PDF/image at 300 dpi; scans (no text layer) get whitened + deskewed. |
| `src/lib/textlayer.js`, `ocr.js`, `chords.js` | Words → pieces (`t`, `tok`, `chord`); OCR via bundled Tesseract; chord maths. |
| `src/lib/chordpro.js` | ChordPro import/export **and `sectionLabel()`** (heading recogniser used by "Find sections from headings"). |
| `src/editor/store.js`, `sections.js`, `music.js` | Editor state (immutable pages, undo = previous `pages`), sections, transpose/capo/layout. Works under plain Node (see `test/editor.test.mjs`). |
| `src/App.jsx`, `PageView.jsx`, `Inspector.jsx`, `dialogs.jsx`, `ui.jsx` | Shell, one page canvas, right-hand tabs, dialogs (incl. print preview), shared controls. |
| `src/lib/printPlan.js`, `exporter.js` | Which sheet each page prints on; 300-dpi page pictures for PDF/print. |
| `src/lib/songSchema.js`, `project.js` | `.chartshift` file validation + limits; load/save. |
| `electron/main.cjs` | Window, IPC with sender checks, CSP, navigation lock, printing. |
| `electron/library.cjs`, `songStore.cjs` | Library folder IPC; file ops that never destroy an unseen version. |
| `electron/safety.cjs` | Pure rules: trusted origins, path containment, limits, zip import plan, print HTML. |
| `electron/harness.cjs` | Smoke + screenshot runs (only when env vars set). |

## Commands

```bash
npm test                 # node --test, ~67 tests, no Electron needed
npm run smoke            # build + drive the real app; scripts/check-smoke.mjs asserts the report
node scripts/check-smoke.mjs release/win-unpacked/ChartShift.exe   # same checks on the packaged app
npm run shots            # screenshots -> screenshots/ (ignored); several sizes + 125%/150% zoom
npm run dist:win         # installer -> release/ChartShift Setup <version>.exe
npm run sample           # regenerate public/sample.pdf (uses [Verse 1] style headings)
```

Preview server name is `chartshift` (port 5183) in `DEV/Claude/.claude/launch.json`. `/?sample` opens the sample; `/?debug` (and dev builds) expose `window.__editor`.

## Release recipe (only when asked)

1. Bump `"version"` in `package.json` (feature → minor, fix/docs → patch), then `npm install --package-lock-only --silent`.
2. `npm test`.
3. `rm -rf release && npm run dist:win`.
4. `node scripts/check-smoke.mjs release/win-unpacked/ChartShift.exe` — must print "All smoke checks passed."
5. `git add -A`, commit (message via `-F` file; end with the Co-Authored-By line), `git push origin main`.
6. Copy the installer to a space-free name, then
   `gh release create vX.Y.Z "release/ChartShift-Setup-X.Y.Z.exe" --title "ChartShift X.Y.Z" --notes-file <file>`; delete the copy.
7. Verify: `gh release view vX.Y.Z --json tagName,isDraft,assets` and `git status -sb`.

Release notes always include: the install line with the "unknown publisher → More info → Run anyway" note (installer is unsigned), what's new in user terms, known limits (no real printer / two-PC sync test yet).

## Gotchas (each one cost time)

- **Stop the preview server before `npm run dist:win`.** Vite watching the folder makes electron-builder fail with `EPERM … rename release\win-unpacked.tmp`.
- **Multi-line patches: write a `.py` (or other) script file with the Write tool and run it.** Bash heredocs in this Git Bash die with `unexpected EOF while looking for matching '` on larger content, and `python -c "…"` with backslashes mangles text (`\1` became a control char in a regex; `\r` in a README path became a carriage return). After any scripted edit containing backslashes, grep the result.
- **Write tool refuses a file changed by a script since last Read** — Read it again, or patch by script.
- **`document.hidden` / covered window:** pdf.js stalls waiting on animation frames unless rendering uses `intent: 'print'` (already set). Browser-pane screenshots often time out; use `npm run shots` (Electron `capturePage`, with retry for the transient `UnknownVizError`).
- **Synthetic pointer events** work for driving the canvas (`setPointerCapture` is wrapped in try/catch for this). The harness and smoke checks rely on it.
- **`window.prompt` does not exist in Electron.** Use a dialog component; `window.confirm` is fine.
- **React removes a `<dialog>` before effect cleanup runs**, so the browser cannot restore focus; `Modal` restores it manually. Keep that.
- **CSP is production-only** (served as a header by the `app://` handler). Dev (Vite) has none. Anything new that needs `eval`, inline script, or a remote fetch will work in dev and break when packaged — the smoke check runs the packaged path, so run it.
- **Renderer-only packages go in `devDependencies`.** Only `jszip` is a runtime dependency (main process); otherwise the installer balloons.
- **Never trust `.chartshift` contents**: every new piece field must be added to `validateSong()` in `songSchema.js`, or it is silently stripped on reopen (and a round-trip test will catch it).
- **Saving never renames over a song.** `songStore.writeSong` moves the existing file aside and keeps it unless it is exactly the version the editor saw. New file operations in the library must use `placeExclusive` / `placeUnique`, not `fs.rename` or `writeFile` onto a song name.
- **Colour tokens are tested** (`test/contrast.test.mjs`): the canvas colours in `render.js` must match the CSS tokens, and all pairs must keep WCAG AA.
- **Sections are per page** (`page.sections` + `piece.section`). Moving pieces to another page must carry the section entry (see `moveSelectionToPage`).
- **A harness scene inserted mid-list can break later scenes' setup** — append new screenshot scenes at the end.

## Known limits to keep honest about

- Saved PDFs and prints are 300-dpi page pictures (text not selectable).
- Transposing re-types chords in a similar font; tab numbers and notation do not transpose.
- Touching letters in a scan are one piece; word grouping can be off for single-spaced chords in proportional fonts.
- Sync conflicts are detected at save time, per PC; the sync service decides if two PCs save before syncing. Setlists are last-save-wins.
- "Print each page at its own size" depends on the printer; only verified as PDF output.
