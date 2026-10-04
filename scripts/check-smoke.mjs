// Runs the app's built-in smoke test in Electron and checks its report.
// Usage: node scripts/check-smoke.mjs [path-to-ChartShift.exe]
// Without a path it runs the source tree through the dev Electron binary.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packaged = process.argv[2];
const electron = packaged || createRequire(import.meta.url)('electron');
const result = spawnSync(electron, packaged ? [] : ['.'], {
  cwd: root,
  encoding: 'utf8',
  timeout: 240000,
  env: { ...process.env, CHARTSHIFT_SMOKE: join(root, 'smoke.png'), CHARTSHIFT_SMOKE_OCR: '1' },
});
const line = (result.stdout || '').split('\n').find((l) => l.startsWith('SMOKE REPORT:'));
if (!line) {
  console.error(result.stdout, result.stderr);
  throw new Error('The smoke test did not produce a report.');
}
const report = JSON.parse(line.slice('SMOKE REPORT:'.length));
console.log(JSON.stringify(report, null, 2));

const checks = {
  'sample opens': () => assert.match(report.status, /Opened Sample chart\.pdf: 2 pages/),
  'library read/write round-trips': () => assert.deepEqual(report.library, { readBack: 4, sameVersion: true }),
  'stale save is detected, not written': () => { assert.equal(report.conflict.detected, 'changed'); assert.equal(report.conflict.untouched, true); },
  'replace keeps the other version as a conflict copy': () => { assert.match(report.conflict.keptName, /^Shared \(conflict copy /); assert.equal(report.conflict.keptIsTheirs, true); },
  'save-as-copy leaves the original alone': () => { assert.match(report.conflict.copyName, /^Shared \(my copy /); assert.equal(report.conflict.copyLeftOriginal, true); },
  'reusing an existing name is detected': () => assert.equal(report.conflict.sameNameDetected, 'exists'),
  'copies made in the same second get distinct names and contents': () => assert.equal(report.conflict.copiesDistinct, true),
  'every control has an accessible name': () => assert.deepEqual([report.a11y.unnamedButtons, report.a11y.unlabelledFields, report.a11y.dialogUnnamed], [0, 0, 0]),
  'one page heading': () => assert.equal(report.a11y.headings, 1),
  'menu works from the keyboard': () => assert.deepEqual([report.a11y.menuFocusesFirstItem, report.a11y.menuArrowMoves, report.a11y.menuEscapeCloses], [true, true, true]),
  'inspector tabs work from the keyboard': () => assert.equal(report.a11y.tabsArrow, true),
  'dialogs are modal, labelled, and restore focus': () => assert.deepEqual([report.a11y.dialogModal, report.a11y.dialogClosesAndRestoresFocus], [true, true]),
  'sections are found from [bracketed] headings': () => assert.deepEqual(report.sections, [['Verse 1', 'Chorus', 'Verse 2'], ['Intro']]),
  'two pages fit side by side': () => assert.equal(report.sideBySide, true),
  'dragging onto another page moves the pieces there': () => {
    const { status, ...flags } = report.dragAcrossPages;
    assert.deepEqual(flags, { previewed: true, leftPageOne: true, arrivedOnPageTwo: true, underPointer: true });
    assert.match(status, /to page 2/);
    assert.equal(report.dragUndone, true);
  },
  'print preview shows every sheet, drawn and described': () => {
    const p = report.printPreview;
    assert.equal(p.title, 'Print preview');
    assert.deepEqual([p.sheets, p.drawn, p.unnamed, p.ownSizeChosen], [2, true, 0, true]);
    assert.match(p.captions[0], /^Sheet 1 of 2: page 1\. 8\.5 × 11 in portrait$/);
  },
  'print preview follows the paper choice': () => {
    const p = report.printPreview;
    assert.equal(p.mixedDefaultsToOnePaper, true);
    assert.deepEqual(p.fitted, ['portrait', 'portrait']);
    assert.match(p.fittedCaption, /turned sideways/);
    assert.deepEqual(p.ownSize, ['portrait', 'landscape']);
    assert.deepEqual([p.stillDrawn, p.closed], [true, true]);
  },
  'a new song opens on the Write tab': () => {
    const w = report.writing;
    assert.deepEqual([w.dialog, w.tab, w.name], ['New song', 'Write', 'Morning Song']);
    assert.ok(w.blankPage.includes('Morning Song') && w.blankPage.includes('Verse 1') && w.blankPage.includes('Chorus'), String(w.blankPage));
  },
  'typed words and [chords] are laid out on the page': () => {
    const w = report.writing;
    for (const text of ['Morning light is on the hills', 'Every shadow fades', 'Lift it up, let it ring']) assert.ok(w.pageAfterTyping.includes(text), text);
    assert.deepEqual(w.chordPieces, ['G', 'C', 'Em', 'D', 'C', 'G']);
    assert.deepEqual(w.sectionsOnPage, ['Verse 1', 'Chorus']);
  },
  'syllable counts and the key\'s chords are shown': () => {
    const w = report.writing;
    assert.deepEqual(w.syllables, ['', '7', '5', '', '', '6']);
    assert.deepEqual(w.palette, ['G1', 'Am2m', 'Bm3m', 'C4', 'D5', 'Em6m', 'F#dim7°']);
    assert.equal(w.inserted, true);
  },
  'chord diagrams are added for the chords used': () => assert.deepEqual(report.writing.diagrams, ['G', 'C', 'Em', 'D']),
  'drafts are kept and restored; transposing rewrites the text': () => {
    const w = report.writing;
    assert.deepEqual(w.draftSaved, ['Draft 1']);
    assert.deepEqual(w.transposed, ['[A]Morning light is [D]on the hills', 'A']);
    assert.deepEqual(w.restored.slice(0, 2), ['[G]Morning light is [C]on the hills', 'G']);
    assert.deepEqual(w.restored[2], ['Before restoring', 'Draft 1']);
  },
  'the structure list reorders the song': () => {
    const w = report.writing;
    assert.deepEqual(w.structure, ['Verse 1', 'Chorus']);
    assert.equal(w.reordered, 'Chorus / Chorus,Verse 1');
  },
  'a written song survives saving and reopening': () => {
    const w = report.writing;
    assert.equal(w.savedAs, 'Morning Song');
    assert.deepEqual(w.reopened, { write: true, sameText: true, title: 'Morning Song', drafts: 2, diagrams: 'guitar', tab: 'Write', diagramPieces: 4 });
    assert.equal(w.unnamed, 0);
  },
  'recovery saves, loads and clears': () => assert.deepEqual(report.recovery, { name: 'x', baseVersion: 'abc', cleared: true }),
  'CSP header is served': () => assert.match(report.csp || '', /default-src 'none'/),
  'eval is blocked': () => assert.equal(report.evalBlocked, true),
  'inline script is blocked': () => assert.equal(report.inlineScriptBlocked, true),
  'path traversal is refused': () => assert.ok(report.traversal.every((s) => s === 403 || s === 404 || s === 'blocked'), String(report.traversal)),
  'remote fetch is blocked': () => assert.equal(report.remoteFetch, 'blocked'),
  'pop-ups are denied': () => assert.equal(report.popup, true),
  'navigation away is blocked': () => assert.match(report.urlAfterNavigation, /^app:\/\/chartshift\//),
  'a second window gets no IPC access': () => assert.equal(report.otherWindow, 'refused'),
  'mixed page sizes print as separate sheet sizes': () => assert.deepEqual(report.mixedPrint, ['612x792', '792x612', '420x595', '612x792']),
  'OCR works under the CSP and finds every chord on the sample': () => assert.match(report.ocr || '', /^Found 20 chords\. Check them/),
};
let failed = 0;
for (const [name, check] of Object.entries(checks)) {
  try { check(); console.log('ok   -', name); } catch (error) { failed++; console.log('FAIL -', name, '\n      ', error.message.split('\n')[0]); }
}
if (failed) { console.error(`${failed} smoke check(s) failed.`); process.exit(1); }
console.log('All smoke checks passed.');
