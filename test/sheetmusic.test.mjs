// Reading printed sheet music: engraved test pieces (clean, and made to look
// scanned) must come back with the right notes, keys, chords and tab.
import { test } from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { readMusic } from '../src/lib/omr.js';
import { analyse, bestChord } from '../src/lib/sheet.js';
import { fretNotes, sheetText, tabRows } from '../src/lib/tab.js';
import { parseChordPro } from '../src/lib/chordpro.js';
import { parseStructure, splitChordPro, transposeText } from '../src/lib/songtext.js';
import { engrave, mei } from './helpers/engrave.mjs';
import { GUITAR, OLD_HUNDREDTH, OLD_HUNDREDTH_CHORDS, OLD_HUNDREDTH_VERSES, TERRA_BEATA, WALTZ_ABC } from './helpers/tunes.mjs';
import { pngBytes } from './helpers/png.mjs';

const SCANNED = { scale: 26, rotate: 0.5, blur: 1, noise: 0.6 };

// How many of the true notes were found in the right bar on the right staff,
// and how many found notes were really there.
function score(found, truth) {
  const key = (staff, measure, midi) => `${staff}/${measure}/${midi}`;
  const want = new Map();
  for (const n of truth) want.set(key(n.staff, n.measure, n.midi), (want.get(key(n.staff, n.measure, n.midi)) || 0) + 1);
  let hits = 0, total = 0;
  found.measures.forEach((m, index) => {
    for (const o of m.onsets) {
      for (const n of o.notes) {
        total++;
        const k = key(m.staffs.indexOf(n.staff) + 1, index + 1, n.midi);
        if (want.get(k) > 0) { hits++; want.set(k, want.get(k) - 1); }
      }
    }
  });
  return { recall: hits / truth.length, precision: total ? hits / total : 0, hits, total, expected: truth.length };
}

async function read(source, options) {
  const { img, notes } = await engrave(typeof source === 'string' ? source : mei(source), options);
  const music = readMusic(img);
  return { music, result: analyse(music), truth: notes };
}

test('a tune on one staff is read note for note, clean and scanned', async () => {
  for (const options of [{}, SCANNED]) {
    const { music, result, truth } = await read(WALTZ_ABC, options);
    assert.equal(music.staffs.length, 1);
    assert.equal(music.staffs[0].clef, 'treble');
    assert.equal(music.staffs[0].fifths, 1, 'one sharp');
    const s = score(result, truth);
    assert.equal(s.recall, 1, `all notes found ${JSON.stringify({ ...s, options })}`);
    assert.equal(s.precision, 1, 'nothing extra');
    assert.deepEqual([result.key, result.beats], [{ index: 7, minor: false }, 3], 'G major, three beats to the bar');
    // Note lengths: the half notes, the pair of eighths and the dotted half.
    assert.deepEqual(result.measures[1].melody.map((n) => n.duration), [2, 0.5, 0.5]);
    assert.equal(result.measures[7].melody[0].duration, 3);
  }
});

test('a four-part hymn on two staffs: every part, the key, and the chords', async () => {
  for (const options of [{}, SCANNED]) {
    const { music, result, truth } = await read(OLD_HUNDREDTH, options);
    assert.equal(music.systems.length, 1);
    assert.deepEqual(music.staffs.map((s) => [s.clef, s.fifths]), [['treble', 1], ['bass', 1]]);
    const s = score(result, truth);
    assert.ok(s.recall >= (options.noise ? 0.97 : 1) && s.precision >= (options.noise ? 0.97 : 1), JSON.stringify({ ...s, options }));
    // The written sharp (G#) in bar 3 belongs to the alto note only.
    if (!options.noise) {
      const bar3 = result.measures[2].onsets.flatMap((o) => o.notes).filter((n) => n.staff === 0).map((n) => n.name + n.octave);
      assert.ok(bar3.includes('G#4') && bar3.includes('B4') && !bar3.includes('B#4'), bar3.join(' '));
    }
    // The tune is the top part.
    assert.deepEqual(result.measures[0].melody.map((n) => n.name + n.octave), ['G4', 'G4', 'F#4', 'E4']);
    assert.equal(result.measures.length, 6);
    result.measures.forEach((m, i) => {
      const names = m.chords.map((c) => c.name);
      const expected = OLD_HUNDREDTH_CHORDS[i];
      assert.equal(names[0], expected[0], `bar ${i + 1}: ${names.join(' ')} ${JSON.stringify(options)}`);
      if (names[1]) assert.match(names[1], expected[1] || /^$/, `bar ${i + 1}: ${names.join(' ')}`);
    });
  }
});

test('a melody with flats, eighth notes and accidentals, clean, smaller and scanned', async () => {
  for (const options of [{}, { scale: 30 }, SCANNED]) {
    const { music, result, truth } = await read(TERRA_BEATA, options);
    assert.ok(music.staffs.length >= 2, 'set on several lines');
    assert.ok(music.staffs.every((s) => s.clef === 'treble' && s.fifths === -1), 'treble clef, one flat, on every line');
    const s = score(result, truth);
    const need = options.noise ? 0.95 : 1;
    assert.ok(s.recall >= need && s.precision >= need, JSON.stringify({ ...s, options }));
    assert.deepEqual(result.key, { index: 5, minor: false }, 'F major');
  }
});

test('guitar music (treble clef with an 8) reads an octave down', async () => {
  const { music, result, truth } = await read(GUITAR);
  assert.equal(music.staffs[0].clef, 'treble8');
  assert.equal(score(result, truth).recall, 1);
  assert.deepEqual(result.measures[0].melody.map((n) => n.name + n.octave), ['E2', 'A2', 'D3', 'G3', 'B3', 'E4']);
  // ...and the tab plays the open strings as open strings, low to high.
  const row = tabRows(result.measures)[0];
  const firstBar = row.lines.map((line) => line.split('|')[1]);
  const order = firstBar.map((bar) => bar.indexOf('0'));
  assert.ok(firstBar.every((bar) => bar.replace(/[-0]/g, '') === ''), firstBar.join(' / '));
  assert.deepEqual([...order].sort((a, b) => b - a), order, 'low E first, top e last');
});

test('chords come from the notes that sound together', () => {
  const notes = (names, duration = 1) => names.map((midi) => ({ midi, duration }));
  const G = { index: 7, minor: false };
  const name = (c) => c && ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][c.root] + c.quality;
  assert.equal(name(bestChord(notes([43, 59, 62, 67]), { key: G, bass: 43 })), 'G');
  assert.equal(name(bestChord(notes([45, 60, 64, 69]), { key: G, bass: 45 })), 'Am');
  assert.equal(name(bestChord(notes([50, 60, 66, 69]), { key: G, bass: 50 })), 'D7', 'the seventh is heard, so it is named');
  assert.equal(name(bestChord(notes([47, 62, 67, 71]), { key: G, bass: 47 })), 'G', 'first inversion is still G');
  assert.equal(bestChord([], { key: G }), null);
  // With only a tune, the main chords of the key win.
  assert.equal(name(bestChord(notes([71, 69]), { key: G, melodyOnly: true })), 'G');
});

test('frets: low on the neck, little movement, and every note playable', () => {
  // A G major scale as written for guitar: G3 A3 B3 C4 D4 E4 F#4 G4.
  const scale = [55, 57, 59, 60, 62, 64, 66, 67].map((midi) => ({ midi }));
  const frets = fretNotes(scale);
  assert.ok(frets.every((p) => p && p.fret <= 5), JSON.stringify(frets));
  const strings = ['e', 'B', 'G', 'D', 'A', 'E'];
  const opens = [76, 71, 67, 62, 57, 52];
  frets.forEach((p, i) => assert.equal(opens[p.string] + p.fret, scale[i].midi, `${strings[p.string]} string fret ${p.fret}`));
  // Out of range: moved by octaves until it fits.
  const [low, high] = fretNotes([{ midi: 40 }, { midi: 100 }]);
  assert.deepEqual([low.octave, high.octave], [1, -1]);
});

test('the chord-and-tab sheet is ChordPro with chords kept as chords', async () => {
  const { result } = await read(WALTZ_ABC);
  const text = sheetText(result, { title: 'Test waltz' });
  assert.match(text, /^\{title: Test waltz\}\n\{key: G\}\n\{time: 3\/4\}\n/);
  const blocks = text.split('{start_of_tab: ').slice(1);
  assert.ok(blocks.length >= 2, 'one block per line of tab');
  for (const block of blocks) {
    const lines = block.split('\n');
    assert.match(lines[1], /^ *\[[A-G]/, 'a row of chords in brackets');
    const tab = lines.filter((l) => /^[eBGDAE]\|/.test(l));
    assert.equal(tab.length, 6);
    assert.ok(tab.every((l) => l.length === tab[0].length), 'all six strings line up');
    assert.ok(tab[0].length <= 74, 'fits across a page');
  }
});

test('a tab sheet stays a tab sheet as a typed song: blocks kept, laid out, one section each', async () => {
  const { result } = await read(WALTZ_ABC);
  const { meta, text } = splitChordPro(sheetText(result, { title: 'Test waltz' }));
  assert.deepEqual([meta.title, meta.key, meta.time], ['Test waltz', 'G', '3/4']);
  assert.match(text, /^\{start_of_tab: Line 1\}\n/);
  assert.equal(text.match(/\{start_of_tab/g).length, text.match(/\{end_of_tab\}/g).length);
  const song = parseChordPro(text);
  const tab = song.lines.filter((l) => l.type === 'tab');
  assert.ok(tab.some((l) => /^e\|/.test(l.text)) && tab.some((l) => /^E\|/.test(l.text)), 'string lines are kept as tab, spaces and all');
  assert.ok(!song.lines.some((l) => l.type === 'lyric'), 'nothing in a tab block is read as words');
  const structure = parseStructure(text);
  assert.deepEqual(structure.sections.map((s) => s.label), text.match(/\{start_of_tab: (Line \d+)\}/g).map((d) => d.slice(15, -1)));
  // Transposing a typed song changes the chords written in the tab blocks.
  assert.match(transposeText(text, 2, false), /\[A\]/);
});

test('a photographed page (bowed paper, a hand\'s shadow, a slight turn) is still read', async () => {
  const photo = { photo: true, blur: 1, noise: 0.4 };
  for (const [piece, need] of [[WALTZ_ABC, 1], [TERRA_BEATA, 0.95], [OLD_HUNDREDTH, 0.95]]) {
    const { result, truth } = await read(piece, photo);
    const s = score(result, truth);
    assert.ok(s.recall >= need && s.precision >= need, JSON.stringify(s));
  }
});

test('shape notes (seven-shape heads) are read by where they sit, whatever their shape', async () => {
  // Floors, not goals: small diamonds and some filled squares are still missed (see HANDOFF.md).
  for (const [piece, tonic, need] of [[WALTZ_ABC, 7, 0.75], [TERRA_BEATA, 5, 0.9], [OLD_HUNDREDTH, 7, 0.85]]) {
    const { result, truth } = await read(piece, { shapes: tonic });
    const s = score(result, truth);
    assert.ok(s.recall >= need && s.precision >= 0.95, JSON.stringify(s));
  }
});

test('a chord chart is made from the verses under the music, chords over the words', { timeout: 120000 }, async () => {
  const ort = await import('onnxruntime-web');
  const { createPaddleOcr } = await import('../src/lib/paddleocr.js');
  const { chordChart, lyricBands } = await import('../src/lib/lyrics.js');
  const { img } = await engrave(mei(OLD_HUNDREDTH_VERSES));
  const music = readMusic(img);
  const result = analyse(music);
  // The app's word reader (PaddleOCR), on the bands of words between the staffs.
  const model = (name) => fs.readFileSync(new URL(`../public/paddleocr/${name}`, import.meta.url));
  const reader = await createPaddleOcr({ ort, det: model('PP-OCRv6_det_small.onnx'), rec: model('PP-OCRv6_rec_small.onnx'), keys: model('rec_keys.txt').toString('utf8') });
  const scale = 1; // the picture's pixels stand in for page points here
  const words = [];
  for (const band of lyricBands(music)) {
    const x = Math.round(band.x0), y = Math.round(band.y0), w = Math.min(img.width - x, Math.round(band.x1 - band.x0)), h = Math.round(band.y1 - band.y0);
    const data = new Uint8ClampedArray(w * h * 4);
    for (let r = 0; r < h; r++) data.set(img.data.subarray(((y + r) * img.width + x) * 4, ((y + r) * img.width + x + w) * 4), r * w * 4);
    for (const word of await reader.readWords({ data, width: w, height: h })) words.push({ text: word.text, x0: word.x0 + x, x1: word.x1 + x, y0: word.y0 + y, y1: word.y1 + y, base: (word.y0 + word.y1) / 2 + y, line: word.line });
  }
  const text = chordChart([{ music, result, rows: [{ base: 0, tokens: words }], scale }], { title: 'Old Hundredth' });
  assert.match(text, /^\{title: Old Hundredth\}\n\{key: G\}\n\{time: 4\/4\}\n/);
  const verse1 = text.split('Verse 1\n')[1].split('\n')[0];
  const verse2 = text.split('Verse 2\n')[1].split('\n')[0];
  // (OCR can misread a word or two; the rest of each line must be there, in order.)
  assert.match(verse1, /^\[G\]\S*.*that on earth do dwell.*cheerful.*voice/, verse1);
  assert.match(verse2, /^\[G\]Know that the .*is God in-?deed.*make/, verse2);
  assert.ok(!/\[[^\]]*[a-z][^\]]*\]/.test(text.replace(/\[[A-G][^\]]*\]/g, '')), 'no stray brackets in the words');
  // Chords sit at the same places in both verses (the same music).
  const where = (line) => [...line.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
  assert.deepEqual(where(verse1), where(verse2));
  assert.ok(!/\[([^\]]+)\]\[\1\]/.test(text), 'a chord is not written twice running');
});

test('a chord over the second word stays there instead of being treated as a pickup', async () => {
  const { lineWithChords } = await import('../src/lib/lyrics.js');
  const line = lineWithChords(
    [{ text: 'first', x: 10 }, { text: 'second', x: 30 }],
    [{ name: 'Ab', x: 10 }, { name: 'Cm', x: 29 }],
    10,
  );
  assert.equal(line, '[Ab]first [Cm]second');
});
