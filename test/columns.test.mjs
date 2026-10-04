// Charts set in two columns (as Ultimate Guitar prints them): chords and
// sections must be found per column, not across the whole page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTokens, chordTokens, isReadable, needsReading, rescanChords, unreadWords } from '../src/lib/textlayer.js';
import { createEditor } from '../src/editor/store.js';
import { exportChordPro } from '../src/lib/chordpro.js';

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

// --- turning a two-column chart into editable text ----------------------------------------

// A page of recognised words laid out like an Ultimate Guitar chart: 6pt characters, 12pt rows.
function chartPage(rowsLeft, rowsRight, { marked = false } = {}) {
  const pieces = [];
  let id = 1, group = 1;
  const add = (x, y, line, size = 10) => {
    for (const m of line.matchAll(/\S+/g)) {
      pieces.push({ id: id++, kind: 'clip', x: x + m.index * CHAR, y: y - size * 0.7, w: m[0].length * CHAR, h: size * 0.7,
        atlas: 0, sx: 1, sy: 1, sw: 10, sh: 10, word: group++, line: group++, block: group++, t: m[0], tok: group++,
        ...(marked && /^(C|G|D|Em)$/.test(m[0]) && !/[a-z]{2}/.test(line.replace(/Em/g, '')) ? { chord: m[0] } : null) });
    }
  };
  add(60, 40, 'Way Maker Chords', 22);
  rowsLeft.forEach((line, i) => add(60, 80 + i * 12, line));
  rowsRight.forEach((line, i) => add(330, 86 + i * 12, line));   // the right column sits half a row lower
  return { id: 1, w: 612, h: 792, pieces, sections: [] };
}
const LEFT = ['[Verse 1]', '        C                   G', 'You are here, moving in our midst', '          D                Em', 'I worship You    I worship You', '', '', '[Chorus]', 'C', 'Way maker, miracle worker'];
const RIGHT = ['[Verse 2]', '        C                    G', 'You are here, touching every heart', '          D               Em', 'I worship You   I worship You', '', '', '[Bridge]', 'Cc', '  Even when I do not see it'];

test('a two-column chart becomes text one column at a time, chords folded into the lyrics', () => {
  const text = exportChordPro([chartPage(LEFT, RIGHT)], 'fallback');
  assert.equal(text, [
    '{title: Way Maker Chords}', '',
    '{comment: Verse 1}', 'You are [C]here, moving in our [G]midst', 'I worship [D]You I worship [Em]You', '',
    '{comment: Chorus}', '[C]Way maker, miracle worker', '',
    '{comment: Verse 2}', 'You are [C]here, touching every [G]heart', 'I worship [D]You I worship [Em]You', '',
    '{comment: Bridge}', '[C]Even when I do not see it', '',
  ].join('\n'));
  assert.ok(!/midst .*touching/.test(text), 'the second column is not spliced into the first');
});

test('the result is the same whether or not the chords had been marked beforehand', () => {
  assert.equal(exportChordPro([chartPage(LEFT, RIGHT, { marked: true })], 'x'), exportChordPro([chartPage(LEFT, RIGHT)], 'x'));
});

test('a chord a character off its word is tidied; one in the middle of a word is kept', () => {
  // D sits one character into "You,", Em over the last letter of "worship", G in the middle of a word.
  const page = chartPage(['           D           Em', 'I worship You, I worship You', '    G', 'Hallelujah'], []);
  const text = exportChordPro([page], 'x');
  assert.ok(text.includes('I worship [D]You, I worship [Em]You'), text);
  assert.ok(text.includes('Hall[G]elujah'), text);
});

test('pages with no recognised text give nothing', () => {
  const blank = chartPage([], []);
  blank.pieces.forEach((p) => { delete p.t; delete p.tok; });
  assert.equal(exportChordPro([blank], 'x'), null);
});

test('chord rows stacked above a wrapped line are paired with the lyric lines in order', () => {
  // As Ultimate Guitar prints a long line: its chords wrap onto two rows, then its words onto two lines.
  const page = chartPage(['[Chorus]', '           C', '   G', '(You are)  Way maker, miracle', 'worker, promise keeper', '                       D', '             Em', 'Light in the darkness,  my God that', ' is who You are'], []);
  const text = exportChordPro([page], 'x');
  assert.equal(text, ['{title: Way Maker Chords}', '', '{comment: Chorus}',
    '(You are) [C]Way maker, miracle', 'wor[G]ker, promise keeper', 'Light in the darkness, [D]my God that', 'is who You [Em]are', ''].join('\n'));
});

test('chord rows with no lyric line beneath stay as rows of chords', () => {
  const page = chartPage(['[Intro]', 'G     C     D', 'Em    C', '', '', '[Verse 1]', '        C', 'You are here'], []);
  assert.equal(exportChordPro([page], 'x'), ['{title: Way Maker Chords}', '', '{comment: Intro}', '[G] [C] [D]', '[Em] [C]', '', '{comment: Verse 1}', 'You are [C]here', ''].join('\n'));
});

test('a chord at the foot of a column is joined to its lyric at the top of the next', () => {
  // Left column ends on a chord row; the words it belongs to start the right column.
  const page = chartPage(
    ['[Verse 1]', '        C', 'You are here', '          D', 'I worship You', '        C'],
    ['You are here, mending every heart', '          D', 'I worship You'],
  );
  const text = exportChordPro([page], 'x');
  assert.ok(text.includes('You are [C]here\nI worship [D]You\nYou are [C]here, mending every heart\nI worship [D]You'), text);
  assert.ok(!/^\[C\]$/m.test(text), 'no chord is left stranded on a line of its own');
});

test('a last page with only a few lines in its second column is still read in columns', () => {
  const full = chartPage(
    Array.from({ length: 20 }, (_, i) => (i % 2 ? 'You are here, moving in our midst' : '        C                   G')),
    Array.from({ length: 20 }, (_, i) => (i % 2 ? 'I worship You, I worship You' : '          D              Em')),
  );
  // The last page: a full left column, and three short rows at the top right, at the same heights as left-hand chords.
  const last = chartPage(
    Array.from({ length: 20 }, (_, i) => (i % 2 ? 'That is who You are' : '                D')),
    ['That is who You are', '                G', 'That is who You are'],
  );
  last.id = 2;
  last.pieces = last.pieces.filter((p) => p.y > 60).map((p) => ({ ...p, id: p.id + 5000, word: p.word + 5000, tok: p.tok + 5000 }));
  const text = exportChordPro([full, last], 'x');
  assert.ok(!/D That is who You are|You are That/.test(text), 'left-hand chords are not run together with right-hand words');
  assert.equal(text.match(/That is who You \[D\]are/g).length, 10);
  assert.ok(text.trimEnd().endsWith('That is who You are\nThat is who You [G]are'), text.slice(-120));
});

test('page numbers in the margin are left out of the text', () => {
  const page = chartPage(['[Outro]', '                C', 'That is who You are', '                G'], []);
  const base = page.pieces.length + 1;
  // "Page 1/3" at the foot of the page, and the next page starting with the words for that last chord.
  'Page 1/3'.split(' ').forEach((word, i) => page.pieces.push({ id: base + i, kind: 'clip', x: 500 + i * 30, y: 770, w: 24, h: 7,
    atlas: 0, sx: 1, sy: 1, sw: 10, sh: 10, word: 9000 + i, line: 9100, block: 9200, t: word, tok: 9300 + i }));
  const second = chartPage(['That is who You are'], []);
  second.id = 2;
  second.pieces = second.pieces.filter((p) => p.y > 60).map((p) => ({ ...p, id: p.id + 7000, word: p.word + 7000, tok: p.tok + 7000 }));
  const text = exportChordPro([page, second], 'x');
  assert.ok(!/Page/.test(text), text);
  assert.ok(text.trimEnd().endsWith('That is who You [C]are\nThat is who You [G]are'), text);
});

// --- rescanning a chart for chords -------------------------------------------------------

const marked = (page) => [...new Map(page.pieces.filter((p) => p.chord).map((p) => [p.tok, p.chord])).values()];

test('a rescan finds the chords an older version missed, in both columns', () => {
  const page = chartPage(LEFT, RIGHT);            // text is read, but nothing is marked as a chord
  assert.deepEqual(marked(page), []);
  const result = rescanChords([page]);
  assert.deepEqual(marked(page).sort(), ['C', 'C', 'C', 'C', 'D', 'D', 'Em', 'Em', 'G', 'G']);
  assert.deepEqual(result, { found: 10, added: 10, corrected: 0, removed: 0 });
  assert.ok(page.pieces.filter((p) => p.t === 'C' && p.chord === 'C').length >= 1, 'the misread "Cc" is now C');
  assert.ok(!page.pieces.some((p) => p.t === 'Cc'));
  assert.ok(page.pieces.filter((p) => /^(You|are|here,|worship|\[Verse|maker,)$/.test(p.t)).every((p) => !p.chord), 'words and headings are not marked');
});

test('a rescan keeps what was already right, corrects misreads, and drops marks that are not chords', () => {
  const page = chartPage(LEFT, RIGHT);
  const set = (text, chord) => page.pieces.filter((p) => p.t === text).forEach((p) => { p.chord = chord; });
  set('G', 'G');                 // already found
  set('[Chorus]', '[Chorus]');   // a heading an older version marked by mistake
  set('Cc', 'Cc');               // a misread that was marked as it stood
  const hand = page.pieces.find((p) => p.t === 'midst');
  hand.chord = 'Am'; hand.t = 'Am';   // a chord the user marked by hand, sitting among lyrics
  const result = rescanChords([page]);
  assert.equal(result.removed, 1);
  assert.equal(result.corrected, 1);
  assert.ok(!page.pieces.some((p) => p.chord === '[Chorus]' || p.chord === 'Cc'));
  assert.equal(hand.chord, 'Am', 'a hand-made mark is kept');
  const again = rescanChords([page]);
  assert.deepEqual([again.added, again.corrected, again.removed], [0, 0, 0], 'a second rescan changes nothing');
});

test('only pages with text still to read are read again', () => {
  const read = chartPage(LEFT, RIGHT);
  assert.equal(needsReading(read.pieces), false);
  // A staff or a rule has no text and never will: it does not make a page "unread".
  read.pieces.push({ id: 99999, kind: 'clip', x: 60, y: 600, w: 400, h: 60, word: 99999, line: 99999, block: 99999 });
  assert.equal(needsReading(read.pieces), false);
  const scan = chartPage(LEFT, RIGHT);
  scan.pieces.forEach((p) => { delete p.t; delete p.tok; });
  assert.equal(needsReading(scan.pieces), true);
  const gaps = chartPage(LEFT, RIGHT);
  gaps.pieces.filter((p) => p.t === 'C' || p.t === 'G').forEach((p) => { delete p.t; delete p.tok; });
  assert.equal(needsReading(gaps.pieces), true, 'several words the PDF gave no text for');
  assert.equal(needsReading([]), false);
});
