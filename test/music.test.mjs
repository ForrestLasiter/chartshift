import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isChord, isChordLine, keyName, keyOf, prefersFlats, toNashville, transposeChord } from '../src/lib/chords.js';
import { estimateSkew, flattenBackground } from '../src/lib/cleanup.js';
import { parseChordPro } from '../src/lib/chordpro.js';

test('recognises chords and rejects ordinary words', () => {
  for (const c of ['G', 'Em', 'F#m7', 'Bb', 'D/F#', 'Csus4', 'Gmaj7', 'A7', 'Cadd9', 'Bdim', 'E7#9', '(G)', 'C(add9)', 'Am7b5']) {
    assert.ok(isChord(c), c);
  }
  for (const w of ['Amazing', 'Grace', 'Be', 'Go', 'Dad', 'the', 'H', 'Add', 'Chorus', 'N.C.']) assert.ok(!isChord(w), w);
});

test('tells chord lines from lyric lines', () => {
  assert.ok(isChordLine(['G', 'C', 'G']));
  assert.ok(isChordLine(['|', 'G', '|', 'D/F#', '|', 'x2']));
  assert.ok(!isChordLine(['A', 'mighty', 'fortress', 'is', 'our', 'God']));
  assert.ok(!isChordLine(['Verse', '1']));
});

test('transposes roots and bass notes, keeping the rest', () => {
  assert.equal(transposeChord('G', 2, false), 'A');
  assert.equal(transposeChord('D/F#', 2, false), 'E/G#');
  assert.equal(transposeChord('F#m7', -1, false), 'Fm7');
  assert.equal(transposeChord('Bbmaj7', 2, false), 'Cmaj7');
  assert.equal(transposeChord('C', 1, true), 'Db');
  assert.equal(transposeChord('C', 1, false), 'C#');
  assert.equal(transposeChord('(Em)', 5, false), '(Am)');
  assert.equal(transposeChord('B', 1, false), 'C');
  assert.equal(transposeChord('hello', 3, false), 'hello');
});

test('spells flat keys with flats', () => {
  const key = keyOf('G');
  assert.equal(keyName(key), 'G');
  const up = { index: key.index + 3, minor: false };
  assert.ok(prefersFlats(up));
  assert.equal(keyName(up), 'Bb');
  assert.deepEqual(keyOf('Em7'), { index: 4, minor: true });
  assert.equal(keyOf('Emaj7').minor, false);
});

test('converts to Nashville numbers', () => {
  const g = keyOf('G');
  assert.deepEqual(['G', 'C', 'D', 'Em', 'D/F#', 'F'].map((c) => toNashville(c, g)), ['1', '4', '5', '6m', '5/7', 'b7']);
  assert.equal(toNashville('Am', keyOf('Am')), '6m');
});

function page(w, h, fill = 255) {
  return { data: new Uint8ClampedArray(w * h * 4).fill(fill), width: w, height: h };
}

test('measures the tilt of skewed rows', () => {
  for (const tilt of [2, -3]) {
    const img = page(900, 700);
    const slope = Math.tan((tilt * Math.PI) / 180);
    for (let row = 80; row < 640; row += 40) {
      for (let x = 60; x < 840; x++) {
        const y = Math.round(row + (x - 450) * slope);
        for (let t = 0; t < 3; t++) {
          const p = ((y + t) * 900 + x) * 4;
          img.data[p] = img.data[p + 1] = img.data[p + 2] = 0;
        }
      }
    }
    assert.ok(Math.abs(estimateSkew(img) + tilt) <= 0.3, `tilt ${tilt} -> ${estimateSkew(img)}`);
  }
  assert.equal(estimateSkew(page(900, 700)), 0);
});

test('whitens grey, unevenly lit paper and leaves clean pages alone', () => {
  assert.equal(flattenBackground(page(300, 300)), false);
  const img = page(300, 300);
  for (let y = 0; y < 300; y++) for (let x = 0; x < 300; x++) {
    const p = (y * 300 + x) * 4;
    const paper = 170 + Math.round((x / 300) * 60); // darker on the left
    const v = y === 150 ? 40 : paper;
    img.data[p] = img.data[p + 1] = img.data[p + 2] = v;
  }
  assert.equal(flattenBackground(img), true);
  const at = (x, y) => img.data[(y * 300 + x) * 4];
  assert.ok(at(20, 40) >= 250 && at(280, 260) >= 250, 'paper is white everywhere');
  assert.ok(at(100, 150) < 90, 'ink stays dark');
});

test('parses ChordPro', () => {
  const song = parseChordPro('{title: Morning Light}\n{key: G}\n{soc}\n[G]Lift it [C]up\n{eoc}\n\n{c: Verse 2}\nPlain line\n');
  assert.equal(song.title, 'Morning Light');
  assert.equal(song.key, 'G');
  assert.deepEqual(song.lines.map((l) => l.type), ['start', 'lyric', 'end', 'blank', 'comment', 'lyric']);
  assert.equal(song.lines[1].lyric, 'Lift it up');
  assert.deepEqual(song.lines[1].chords, [{ index: 0, name: 'G' }, { index: 8, name: 'C' }]);
});
