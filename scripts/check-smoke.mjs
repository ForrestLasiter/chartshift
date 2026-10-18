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
  env: { ...process.env, CHARTSHIFT_SMOKE: join(root, 'smoke.png'), CHARTSHIFT_SMOKE_OCR: '1', CHARTSHIFT_SHEET: join(root, 'test', 'fixtures', 'old-hundredth.png') },
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
  'rescan finds the chords again and reports what changed': () => {
    const r = report.rescan;
    assert.equal(r.before, 0);
    assert.equal(r.after, 'G C G Em C D C G D Em C G D G G C G Em C D');
    assert.match(r.status, /^Found 20 chords\./);
    assert.equal(r.review, 'Check the chords');
    assert.match(r.again, /^Found 20 chords\. Nothing new was found\./);
  },
  'two columns fit a long song on fewer pages, inside the page, with long lines wrapped': () => {
    const c = report.columns;
    assert.ok(c.twoPages < c.onePages, `${c.twoPages} pages in two columns, ${c.onePages} in one`);
    assert.deepEqual([c.rightColumnUsed, c.insidePage, c.wrapped, c.saved], [true, true, true, 2]);
    assert.equal(c.allWordsKept, 16);
    assert.equal(c.chords, 64);
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
  'a chart with no staffs has no sheet music to read': () => {
    assert.deepEqual(report.sheet.empty, { title: 'Read sheet music', text: 'No music was found. ChartShift looks for printed staffs (five lines) with notes on them.' });
  },
  'printed music is read: notes, key, chords bar by bar, and a tab preview': () => {
    const s = report.sheet;
    assert.equal(s.pages, 1);
    assert.equal(s.summary, '76 notes on 1 line of music. Key of G · 4/4');
    assert.equal(s.lines.length, 1);
    assert.match(s.lines[0], /^Line 1: \| G \| G \| G /);
    assert.match(s.preview, /^ +G +G /, 'chords above the tab, in line with it');
    const strings = s.preview.split('\n').filter((l) => /^[eBGDAE]\|/.test(l)).length;
    assert.ok(strings >= 6 && strings % 6 === 0, `${strings} string lines`);
    assert.deepEqual(s.boxes, [true, true], 'chords and note names, as the chart has no chords of its own');
    assert.equal(s.unnamed, 0);
  },
  'chords and note names go onto the page, and the chords transpose': () => {
    const s = report.sheet;
    assert.ok(s.chords.length >= 6 && s.chords[0] === 'G', s.chords.join(' '));
    assert.deepEqual(s.notes.slice(0, 4), ['G', 'G', 'F#', 'E'], 'the tune is the top part');
    assert.equal(s.notes.length, 19);
    assert.match(s.status, /^Added \d+ chords and 19 note names\./);
    assert.equal(s.transposed[0], 'A');
    assert.equal(s.transposed.length, s.chords.length);
  },
  'a chord and tab sheet is made as a new typed song': () => {
    const s = report.sheet;
    assert.deepEqual([s.written, s.name], [true, 'Old Hundredth (chords and tab)']);
    assert.ok(s.tabBlocks >= 1);
    assert.deepEqual(s.strings, ['e|', 'B|', 'G|', 'D|', 'A|', 'E|']);
    assert.equal(s.stringsLinedUp, true, 'six strings in a fixed-width font, one under another');
    assert.ok(s.sheetChords >= 6);
  },
  'the camera and the microphone are refused': () => {
    // Refused by the app, or (on a PC without one) not there at all; never granted.
    for (const device of ['camera', 'microphone']) assert.ok(['NotAllowedError', 'NotFoundError', 'NotReadableError'].includes(report.devices[device]), `${device}: ${report.devices[device]}`);
  },
  'checking for updates asks GitHub and reports the result': () => {
    const u = report.updates;
    assert.equal(u.title, 'Check for updates');
    assert.equal(u.unnamed, 0);
    if (u.check.offline) { console.log('       (no internet: update check answered "' + u.check.offline + '")'); assert.match(u.shown, /GitHub|internet/); return; }
    assert.match(u.check.latest, /^\d+\.\d+\.\d+$/);
    assert.match(u.check.name, /^ChartShift-Setup-\d+\.\d+\.\d+\.exe$/);
    assert.equal(typeof u.check.available, 'boolean');
    assert.equal(u.check.hidesUrl, true);
    assert.match(u.shown, u.check.available ? /is available/ : /up to date/);
  },
  'nothing is downloaded or run without an update to install': () => {
    const u = report.updates;
    if (!u.check.offline && u.check.available === false) assert.match(u.downloadRefusedWhenCurrent, /no update to download/);
    assert.match(u.installRefusedWithoutDownload, /not been downloaded/);
  },
  'the start-up check is off by default and the setting is remembered': () => {
    const u = report.updates;
    assert.deepEqual([u.settingDefault, u.settingOn, u.settingOff, u.noteWhenOff], [false, true, false, false]);
    assert.equal(u.settingIgnoresJunk, '{"checkUpdatesAtStartup":true}', 'only the known setting is accepted, and only as true or false');
  },
  'with the setting on, a newer version is announced at start-up': () => {
    const st = report.startup;
    assert.equal(st.quietWhenOff, true, 'nothing is checked or shown while the setting is off');
    if (report.updates.check.offline) { console.log('       (no internet: start-up check not exercised)'); return; }
    assert.equal(st.note, 'Update available');
    assert.match(st.status, /^ChartShift \d+\.\d+\.\d+ is available/);
    assert.match(st.dialog, /is available\. You have 0\.0\.1/);
    assert.deepEqual([st.checkbox, st.offersDownload], [true, true]);
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
