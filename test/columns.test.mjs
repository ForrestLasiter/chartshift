// Charts set in two columns (as Ultimate Guitar prints them): chords and
// sections must be found per column, not across the whole page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTokens, chordTokens, isReadable, unreadWords } from '../src/lib/textlayer.js';
import { createEditor } from '../src/editor/store.js';

// Monospace layout: 6pt per character at 10pt type.
const CHAR = 6, SIZE = 10;
function rowAt(y, startX, line) {
  return [...line.matchAll(/\S+/g)].map((m) => ({ text: m[0], x0: startX + m.index * CHAR, x1: startX + (m.index + m[0].length) * CHAR, y0: y - SIZE * 0.95, y1: y + SIZE * 0.3 }));
}
const chordsIn = (tokens, options) => [...chordTokens(tokens, options).values()];

test('a chord row is found even when the other column has lyrics at the same height', () => {
  const tokens = [...rowAt(100, 72, '      C                 G'), ...rowAt(100, 330, 'worker, promise keeper')].sort((a, b) => a.x0 - b.x0);
  assert.deepEqual(chordsIn(tokens), ['C', 'G']);
  // …and the other way round: lyrics on the left, chords on the right.
  const flipped = [...rowAt(100, 72, 'You are here, moving in our midst'), ...rowAt(100, 330, '   G        Em')].sort((a, b) => a.x0 - b.x0);
  assert.deepEqual(chordsIn(flipped), ['G', 'Em']);
});

test('a chord standing alone beside lyrics is found', () => {
  const tokens = [...rowAt(100, 72, 'I worship You       I worship You'), ...rowAt(100, 330, '        D')].sort((a, b) => a.x0 - b.x0);
  assert.deepEqual(chordsIn(tokens), ['D']);
  assert.deepEqual(chordsIn(rowAt(100, 72, '         C')), ['C']);
});

test('ordinary words that look like chords are not mistaken for them', () => {
  assert.deepEqual(chordsIn(rowAt(100, 72, 'A mighty fortress is our God')), []);
  assert.deepEqual(chordsIn(rowAt(100, 72, 'Here I Am to worship')), []);
  assert.deepEqual(chordsIn(rowAt(100, 72, 'Let it Be')), []);
  // A phrase after a wide gap that starts with "A" is still a phrase.
  assert.deepEqual(chordsIn(rowAt(100, 72, 'You are here          A mighty God')), []);
  // Two columns of lyrics.
  const lyrics = [...rowAt(100, 72, 'I worship You'), ...rowAt(100, 330, 'A light in the dark')].sort((a, b) => a.x0 - b.x0);
  assert.deepEqual(chordsIn(lyrics), []);
});

test('ordinary chord rows still work, including marks between chords', () => {
  assert.deepEqual(chordsIn(rowAt(100, 72, 'G     C     D     Em')), ['G', 'C', 'D', 'Em']);
  assert.deepEqual(chordsIn(rowAt(100, 72, '| G | D/F# | Em | x2')), ['G', 'D/F#', 'Em']);
  assert.deepEqual(chordsIn(rowAt(100, 72, 'C G Am F')), ['C', 'G', 'Am', 'F']);
});

// Pieces to receive the tokens: one piece per word, same boxes.
function piecesFor(tokens) {
  return tokens.map((t, i) => ({ id: i + 1, kind: 'clip', x: t.x0, y: t.y0 + 2, w: t.x1 - t.x0, h: SIZE * 0.7, word: i + 1, line: 1, block: 1 }));
}

test('chords in both columns end up marked on their pieces', () => {
  const rows = [
    { tokens: [...rowAt(100, 72, '      C                 G'), ...rowAt(100, 330, 'worker, promise keeper')] },
    { tokens: [...rowAt(115, 72, 'You are here, moving in our midst'), ...rowAt(115, 330, '        D')] },
  ];
  const pieces = piecesFor(rows.flatMap((r) => r.tokens));
  const result = applyTokens(pieces, rows, { group: 100 });
  assert.equal(result.chords, 3);
  assert.deepEqual(pieces.filter((p) => p.chord).map((p) => p.chord).sort(), ['C', 'D', 'G']);
  assert.ok(pieces.filter((p) => !p.chord).every((p) => p.t), 'lyrics keep their text and are not chords');
});

test('filling in missed text leaves words that were already read alone', () => {
  const tokens = rowAt(100, 72, 'G     C');
  const pieces = piecesFor(tokens);
  pieces[0].t = 'G'; pieces[0].tok = 7; pieces[0].chord = 'G';
  applyTokens(pieces, [{ tokens: [{ ...tokens[0], text: 'Q' }, tokens[1]] }], { group: 100 }, { uncertain: true, onlyUnread: true });
  assert.deepEqual([pieces[0].t, pieces[0].chord, pieces[0].tok], ['G', 'G', 7], 'existing text is not overwritten by a worse reading');
  assert.equal(pieces[1].chord, 'C');
});

// --- sections in columns ---------------------------------------------------------

function editorWithColumns() {
  const ids = { piece: 1, group: 1, page: 1 };
  const pieces = [];
  const add = (x, y, text) => text.split(' ').forEach((word, i) => {
    pieces.push({ id: ids.piece++, kind: 'clip', x: x + i * 40, y, w: 34, h: 10, atlas: 0, sx: 1, sy: 1, sw: 10, sh: 10,
      word: ids.group++, line: Math.round(x) * 1000 + y, block: ids.group++, t: word, tok: ids.group++ });
  });
  add(72, 40, 'Way Maker');
  add(72, 100, '[Verse 1]'); add(72, 120, 'C G'); add(72, 135, 'You are here'); add(72, 300, 'I worship You');
  add(72, 340, '[Verse 2]'); add(72, 360, 'D Em');
  add(330, 96, '[Chorus]'); add(330, 120, 'C'); add(330, 135, 'Way maker'); add(330, 400, 'is who You are');
  const ed = createEditor();
  ed.setDoc({ pages: [{ id: ids.page++, w: 612, h: 792, pieces, sections: [] }], atlases: [], ids, name: 'Columns', status: '' });
  return ed;
}

test('sections stay within their own column', () => {
  const ed = editorWithColumns();
  ed.autoSections();
  const sections = ed.sectionList(0);
  assert.deepEqual(sections.map((s) => s.label).sort(), ['Chorus', 'Verse 1', 'Verse 2']);
  const words = (label) => {
    const id = sections.find((s) => s.label === label).id;
    return ed.getState().pages[0].pieces.filter((p) => p.section === id).map((p) => p.t).join(' ');
  };
  assert.equal(words('Verse 1'), '[Verse 1] C G You are here I worship You');
  assert.equal(words('Verse 2'), '[Verse 2] D Em');
  assert.equal(words('Chorus'), '[Chorus] C Way maker is who You are', 'the right-hand column runs to the bottom of the page');
  const title = ed.getState().pages[0].pieces.filter((p) => p.y === 40);
  assert.ok(title.every((p) => p.section == null));
});

// --- text a PDF could not supply ------------------------------------------------------

test('garbled text from a font with no character table counts as unread', () => {
  for (const text of ['C', 'Em7', 'D/F#', 'worker,', '(You', 'naïve', '“Way”', '日本']) assert.ok(isReadable(text), text);
  for (const text of ['\u0001', 'C\u0003', '\ue012\ue034', '\ufffd', 'G\uf0b7']) assert.ok(!isReadable(text), JSON.stringify(text));
});

test('counts the words on a page that have no text', () => {
  const piece = (word, extra = {}) => ({ kind: 'clip', word, h: 8, ...extra });
  const pieces = [
    piece(1, { t: 'You' }), piece(2, { t: 'are' }), piece(2),          // word 2 is read (one of its letters has text)
    piece(3), piece(4), piece(5),                                        // three unread words
    piece(6, { h: 2 }), piece(7, { contained: true }), piece(8, { frame: true }), // specks, staff contents, frames: ignored
    { kind: 'text', text: 'note' },
  ];
  assert.equal(unreadWords(pieces), 3);
});

// --- chords read by OCR from a scan (the Way Maker case) --------------------------------

test('OCR near misses are repaired and judged like any other chord', () => {
  // "C" is often read as "Cc"; here it shares its height with lyrics in the other column.
  const tokens = [...rowAt(100, 72, '      Cc              G'), ...rowAt(100, 330, '(You are)  Way maker, miracle')].sort((a, b) => a.x0 - b.x0);
  assert.deepEqual(chordsIn(tokens, { repair: true }), ['C', 'G']);
  assert.deepEqual(chordsIn(tokens), ['G'], 'without repair the misread letter is left alone');
  assert.deepEqual(chordsIn(rowAt(100, 72, '          Cc'), { repair: true }), ['C']);
  assert.deepEqual(chordsIn(rowAt(100, 72, '   Ern        D'), { repair: true }), ['Em', 'D']);
  // Repair never turns lyric words into chords.
  assert.deepEqual(chordsIn(rowAt(100, 72, 'Come and see the Glory'), { repair: true }), []);
  assert.deepEqual(chordsIn(rowAt(100, 72, 'God         Be        Called'), { repair: true }), []);
});

test('scan chords are marked across both columns, with misreads corrected', () => {
  const rows = [
    { tokens: [...rowAt(100, 72, '      Cc              G'), ...rowAt(100, 330, '     Cc')] },
    { tokens: [...rowAt(112, 72, 'You are here, moving in our midst'), ...rowAt(112, 330, '(You are)  Way maker, miracle')] },
    { tokens: [...rowAt(124, 72, '       D              Em'), ...rowAt(124, 330, '  G')] },
    { tokens: [...rowAt(136, 72, 'I worship You'), ...rowAt(136, 330, 'worker, promise keeper')] },
  ];
  const pieces = piecesFor(rows.flatMap((r) => r.tokens));
  const result = applyTokens(pieces, rows, { group: 100 }, { uncertain: true });
  assert.equal(result.chords, 6);
  assert.deepEqual(pieces.filter((p) => p.chord).map((p) => p.chord), ['C', 'G', 'C', 'D', 'Em', 'G']);
  assert.ok(pieces.filter((p) => p.chord).every((p) => p.t === p.chord), 'the stored text is the corrected chord');
  assert.ok(pieces.filter((p) => !p.chord).every((p) => p.t && !/^[CDG]$/.test(p.t)));
});
