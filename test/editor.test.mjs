// Editor behaviour that needs no browser: finding sections from headings and
// moving pieces between pages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../src/editor/store.js';
import { sectionLabel } from '../src/lib/chordpro.js';

test('recognises section headings in the styles charts are written in', () => {
  const headings = {
    '[Verse 1]': 'Verse 1', '[Chorus]': 'Chorus', '[Pre-Chorus]': 'Pre-Chorus', '[Intro]': 'Intro', '[Outro]': 'Outro',
    '[Guitar Solo]': 'Guitar Solo', '[Instrumental]': 'Instrumental', '[Hook]': 'Hook', '[Chorus] x2': 'Chorus',
    '[Verse 1: John]': 'Verse 1: John', '(Bridge)': 'Bridge', 'Verse 2:': 'Verse 2', 'Chorus x2': 'Chorus x2',
    'CHORUS': 'CHORUS', 'Intro riff': 'Intro riff', '  [ Verse 3 ]  ': 'Verse 3',
    'IVerse 1]': 'Verse 1', // OCR reading "[" as "I"
  };
  for (const [text, label] of Object.entries(headings)) assert.equal(sectionLabel(text), label, text);
  for (const text of ['[G]', '[Am7]', '[D/F#]', '(softly)', '(x2)', 'Bridge over troubled water', 'Amazing grace how sweet the sound',
    'G  C  D', 'Verse of the day is long and winding', '', 'Em', '[' + 'x'.repeat(60) + ']']) {
    assert.equal(sectionLabel(text), null, text);
  }
});

// A page of recognised words: rows = [[y, 'word word …'], …]; each word is one piece.
function pageOf(id, rows, ids) {
  const pieces = [];
  rows.forEach(([y, text], line) => {
    text.split(' ').forEach((word, i) => {
      pieces.push({ id: ids.piece++, kind: 'clip', x: 72 + i * 60, y, w: 50, h: 10, atlas: 0, sx: 1, sy: 1, sw: 10, sh: 10,
        word: ids.group++, line: 1000 * id + line, block: 1000 * id + line, t: word, tok: ids.group++ });
    });
  });
  return { id, w: 612, h: 792, pieces, sections: [] };
}

function editorWith(...pageRows) {
  const ids = { piece: 1, group: 1, page: 1 };
  const pages = pageRows.map((rows) => pageOf(ids.page++, rows, ids));
  const ed = createEditor();
  ed.setDoc({ pages, atlases: [], ids, name: 'Test', status: '' });
  return ed;
}
const textOf = (ed, pageIndex, sectionId) => ed.getState().pages[pageIndex].pieces.filter((p) => p.section === sectionId).map((p) => p.t).join(' ');

test('finds sections from Ultimate Guitar style [bracketed] headings', () => {
  const ed = editorWith([
    [60, 'Amazing Grace'],
    [100, '[Intro]'], [115, 'G C G'],
    [150, '[Verse 1]'], [165, 'G C G'], [180, 'Amazing grace how sweet the sound'],
    [220, '[Chorus]'], [235, 'C G D'], [250, 'My chains are gone'],
    [290, '[Guitar Solo]'], [305, 'Em C G D'],
  ]);
  ed.autoSections();
  const sections = ed.sectionList(0);
  assert.deepEqual(sections.map((s) => s.label), ['Intro', 'Verse 1', 'Chorus', 'Guitar Solo']);
  assert.equal(textOf(ed, 0, sections[1].id), '[Verse 1] G C G Amazing grace how sweet the sound');
  assert.equal(textOf(ed, 0, sections[2].id), '[Chorus] C G D My chains are gone');
  assert.ok(ed.getState().pages[0].pieces.filter((p) => p.t === 'Amazing' && p.y === 60).every((p) => p.section == null), 'the title stays outside the sections');
  assert.match(ed.getState().status, /Made 4 sections/);
});

test('still finds plain headings, and says why when there are none', () => {
  const plain = editorWith([[100, 'Verse 1'], [115, 'G C'], [150, 'Chorus x2'], [165, 'D Em']]);
  plain.autoSections();
  assert.deepEqual(plain.sectionList(0).map((s) => s.label), ['Verse 1', 'Chorus x2']);

  const none = editorWith([[100, 'G C G'], [115, 'Just some words here']]);
  none.autoSections();
  assert.equal(none.sectionList(0).length, 0);
  assert.match(none.getState().status, /No headings such as/);

  const scan = editorWith([[100, 'x']]);
  scan.set({ pages: scan.getState().pages.map((p) => ({ ...p, pieces: p.pieces.map(({ t, tok, ...rest }) => rest) })) });
  scan.autoSections();
  assert.match(scan.getState().status, /no readable text yet/);
});

test('moves the selection to another page, keeping its section', () => {
  const ed = editorWith([[40, 'stays here'], [100, '[Chorus]'], [115, 'C G D']], [[100, 'page two']]);
  ed.autoSections();
  const chorus = ed.sectionList(0)[0];
  ed.selectSection(0, chorus.id);
  const moving = ed.getState().pages[0].pieces.filter((p) => p.section === chorus.id);
  const before = moving.map((p) => ({ id: p.id, x: p.x, y: p.y }));

  ed.moveSelectionToPage(0, 1, 10, 200);

  const [first, second] = ed.getState().pages;
  assert.deepEqual(first.pieces.map((p) => p.t), ['stays', 'here']);
  assert.equal(first.sections.length, 0, 'the section leaves the first page with its pieces');
  assert.deepEqual(second.sections.map((s) => s.label), ['Chorus']);
  for (const was of before) {
    const now = second.pieces.find((p) => p.id === was.id);
    assert.ok(now, 'piece arrived on page 2');
    assert.deepEqual([now.x, now.y, now.section], [was.x + 10, was.y + 200, chorus.id]);
  }
  assert.equal(second.pieces.length, 2 + before.length);
  assert.equal(ed.getState().activePage, 1);
  assert.match(ed.getState().status, /Moved 4 pieces to page 2/);

  ed.undo();
  assert.equal(ed.getState().pages[0].pieces.length, 6, 'one undo puts everything back');
  assert.equal(ed.getState().pages[1].pieces.length, 2);
  assert.deepEqual(ed.sectionList(0).map((s) => s.label), ['Chorus']);
});

test('moving to another page ignores a page that does not exist', () => {
  const ed = editorWith([[100, 'only page']]);
  ed.selectAll();
  const before = ed.getState().pages;
  ed.moveSelectionToPage(0, 3, 5, 5);
  ed.moveSelectionToPage(0, 0, 5, 5);
  assert.equal(ed.getState().pages, before);
});
