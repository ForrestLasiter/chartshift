// Songwriting: song text, structure, chords in a key, syllables, chord diagrams.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chordsInKey, noteIndex, parseChord, parseKey } from '../src/lib/chords.js';
import { parseChordPro } from '../src/lib/chordpro.js';
import {
  chordsUsed, deleteSection, duplicateSection, headingOf, joinChordPro, lineSyllables, mapChords, moveSection,
  nextHeading, parseStructure, splitChordPro, syllables, transposeText,
} from '../src/lib/songtext.js';
import { CHORD_TONES, INSTRUMENTS, shapeFor, shapeNotes } from '../src/lib/diagrams.js';

const SONG = `Verse 1
[G]Morning light is [C]on the hills
[Em]Every shadow [D]fades

[Chorus]
[C]Lift it [G]up

Verse 2
[G]Evening comes`;

test('headings are told apart from chords and lyrics', () => {
  for (const [line, label] of [['Verse 1', 'Verse 1'], ['[Chorus]', 'Chorus'], ['Chorus x2', 'Chorus x2'], ['[Guitar Solo]', 'Guitar Solo'], ['  Bridge:  ', 'Bridge']]) {
    assert.equal(headingOf(line), label, line);
  }
  for (const line of ['[G]', '[G] [C] [D]', '[G]Amazing grace', 'Verse of mine [G]is here', '', 'Amazing grace']) assert.equal(headingOf(line), null, line);
});

test('song text parses into headings, lyrics and chords', () => {
  const song = parseChordPro(SONG);
  assert.deepEqual(song.lines.map((l) => l.type), ['heading', 'lyric', 'lyric', 'blank', 'heading', 'lyric', 'blank', 'heading', 'lyric']);
  assert.equal(song.lines[0].label, 'Verse 1');
  assert.equal(song.lines[4].label, 'Chorus');
  assert.deepEqual(song.lines[1], { type: 'lyric', lyric: 'Morning light is on the hills', chords: [{ index: 0, name: 'G' }, { index: 17, name: 'C' }] });
});

test('a ChordPro file splits into header facts and body, and joins back', () => {
  const file = '{title: Morning Light}\n{artist: Us}\n{key: G}\n{tempo: 92}\n{time: 4/4}\n{capo: 2}\n\n{comment: Verse 1}\n[G]Morning light\n{soc}\n[C]Lift it up\n{eoc}\n';
  const { meta, text } = splitChordPro(file);
  assert.deepEqual(meta, { title: 'Morning Light', artist: 'Us', key: 'G', tempo: '92', time: '4/4', capo: '2' });
  assert.equal(text, 'Verse 1\n[G]Morning light\nChorus\n[C]Lift it up');
  const back = joinChordPro(meta, text);
  assert.match(back, /^\{title: Morning Light\}\n\{artist: Us\}\n\{key: G\}\n\{tempo: 92\}\n\{time: 4\/4\}\n\{capo: 2\}\n\n\{comment: Verse 1\}\n\[G\]Morning light\n\{comment: Chorus\}\n\[C\]Lift it up\n$/);
  assert.deepEqual(splitChordPro(back), { meta, text });
});

test('the song structure can be reordered, repeated and trimmed', () => {
  const { intro, sections } = parseStructure('A note at the top\n\n' + SONG);
  assert.deepEqual(intro.filter(Boolean), ['A note at the top']);
  assert.deepEqual(sections.map((s) => s.label), ['Verse 1', 'Chorus', 'Verse 2']);

  const labels = (text) => parseStructure(text).sections.map((s) => s.label);
  const moved = moveSection(SONG, 1, -1);
  assert.deepEqual(labels(moved), ['Chorus', 'Verse 1', 'Verse 2']);
  assert.ok(moved.startsWith('[Chorus]\n[C]Lift it [G]up\n\nVerse 1\n[G]Morning light'), 'a section moves with its lines, separated by one blank line');
  assert.equal(moveSection(SONG, 0, -1), SONG, 'cannot move past the ends');
  assert.equal(moveSection(SONG, 2, 1), SONG);

  const repeated = duplicateSection(SONG, 1);
  assert.deepEqual(labels(repeated), ['Verse 1', 'Chorus', 'Chorus', 'Verse 2']);
  assert.equal(repeated.match(/\[C\]Lift it \[G\]up/g).length, 2);

  const trimmed = deleteSection(SONG, 0);
  assert.deepEqual(labels(trimmed), ['Chorus', 'Verse 2']);
  assert.ok(!trimmed.includes('Morning light'));
  assert.equal(nextHeading(SONG, 'Verse'), 'Verse 3');
  assert.equal(nextHeading(SONG, 'Bridge'), 'Bridge');
  assert.equal(nextHeading('', 'Verse'), 'Verse 1');
});

test('chords in the text are transposed; headings and other brackets are not', () => {
  const up = transposeText(SONG, 2, false);
  assert.ok(up.includes('[A]Morning light is [D]on the hills'));
  assert.ok(up.includes('[F#m]Every shadow [E]fades'));
  assert.ok(up.includes('[Chorus]'), 'a bracketed heading is not treated as a chord');
  assert.equal(transposeText('[G]one [x2] [D/F#]two', 1, true), '[Ab]one [x2] [Eb/G]two');
  assert.equal(mapChords('[G] and [C]', (c) => c.toLowerCase()), '[g] and [c]');
  assert.deepEqual(chordsUsed(SONG), ['G', 'C', 'Em', 'D']);
});

test('the chords of a key', () => {
  assert.deepEqual(chordsInKey(parseKey('G')).map((c) => c.name), ['G', 'Am', 'Bm', 'C', 'D', 'Em', 'F#dim']);
  assert.deepEqual(chordsInKey(parseKey('G')).map((c) => c.number), ['1', '2m', '3m', '4', '5', '6m', '7°']);
  assert.deepEqual(chordsInKey(parseKey('F')).map((c) => c.name), ['F', 'Gm', 'Am', 'Bb', 'C', 'Dm', 'Edim']);
  assert.deepEqual(chordsInKey(parseKey('Em')).map((c) => c.name), ['Em', 'F#dim', 'G', 'Am', 'Bm', 'C', 'D']);
  assert.deepEqual(chordsInKey(parseKey('Bb')).map((c) => c.name), ['Bb', 'Cm', 'Dm', 'Eb', 'F', 'Gm', 'Adim']);
  assert.deepEqual(parseKey('f#m'), { index: 6, minor: true });
  assert.equal(parseKey('H'), null);
  assert.deepEqual(chordsInKey(null), []);
});

test('syllables are counted well enough to compare lines', () => {
  const expected = {
    amazing: 3, grace: 1, how: 1, sweet: 1, the: 1, sound: 1, that: 1, saved: 1, a: 1, wretch: 1, like: 1, me: 1,
    morning: 2, light: 1, shadow: 2, miracle: 3, worker: 2, promise: 2, keeper: 2, darkness: 2, worship: 2,
    heaven: 2, glory: 2, hallelujah: 4, every: 2, beautiful: 3, table: 2, make: 1, maker: 2, you: 1, are: 1, here: 1,
    moving: 2, midst: 1, working: 2, place: 1, never: 2, stop: 1, even: 2, when: 1, feel: 1, turning: 2, lives: 1, around: 2,
  };
  for (const [word, count] of Object.entries(expected)) assert.equal(syllables(word), count, word);
  assert.equal(lineSyllables('[G]Amazing [C]grace, how [G]sweet the sound'), 8);
  assert.equal(lineSyllables('You are here, moving in our midst'), 8);
  assert.equal(lineSyllables('Verse 1'), null);
  assert.equal(lineSyllables('[G]  [C]  [D]'), null);
  assert.equal(lineSyllables(''), null);
});

// Every diagram is checked against the notes its chord must contain.
const ROOTS = ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
for (const instrument of Object.keys(INSTRUMENTS)) {
  test(`${instrument} diagrams sound the right notes`, () => {
    let checked = 0;
    for (const root of ROOTS) {
      for (const [type, tones] of Object.entries(CHORD_TONES)) {
        const name = root + type;
        const shape = shapeFor(name, instrument);
        if (!shape) { assert.ok(instrument === 'ukulele', `${name}: guitar has a shape for every basic chord`); continue; }
        const strings = INSTRUMENTS[instrument].tuning.length;
        assert.equal(shape.frets.length, strings, name);
        const rootIndex = noteIndex(parseChord(name).root);
        const wanted = new Set((shape.simplified ? CHORD_TONES[''] : tones).map((t) => (t + rootIndex) % 12));
        const sounded = new Set(shapeNotes(shape.frets, instrument));
        for (const note of sounded) assert.ok(wanted.has(note), `${name} on ${instrument} ${JSON.stringify(shape.frets)} sounds a wrong note (${note})`);
        assert.ok(sounded.has(rootIndex), `${name} includes its root`);
        const third = [...wanted].filter((n) => n !== rootIndex && n !== (rootIndex + 7) % 12);
        assert.ok(third.every((n) => sounded.has(n)), `${name} on ${instrument} ${JSON.stringify(shape.frets)} is missing a defining note`);
        const fretted = shape.frets.filter((f) => f > 0);
        assert.ok(!fretted.length || Math.max(...fretted) - Math.max(shape.baseFret, 1) <= 3, `${name} fits in four frets`);
        checked++;
      }
    }
    assert.ok(checked >= (instrument === 'guitar' ? 100 : 70), `${checked} shapes checked`);
  });
}

test('diagram lookups cope with the ways chords are written', () => {
  assert.deepEqual(shapeFor('G').frets, [3, 2, 0, 0, 0, 3]);
  assert.deepEqual(shapeFor('D/F#'), { frets: [-1, -1, 0, 2, 3, 2], baseFret: 1, simplified: true });
  assert.deepEqual(shapeFor('Bm').frets, [-1, 2, 4, 4, 3, 2]);
  assert.deepEqual(shapeFor('F#m').frets, [2, 4, 4, 2, 2, 2]);
  assert.equal(shapeFor('C9').simplified, true);
  assert.deepEqual(shapeFor('C9').frets, shapeFor('C7').frets);
  assert.deepEqual(shapeFor('Cadd9').frets, [-1, 3, 2, 0, 3, 0]);
  assert.equal(shapeFor('Cdim'), null);
  assert.equal(shapeFor('hello'), null);
  assert.deepEqual(shapeFor('C', 'ukulele').frets, [0, 0, 0, 3]);
  assert.deepEqual(shapeFor('Bb', 'ukulele').frets, [3, 2, 1, 1]);
  assert.equal(shapeFor('Ebm', 'guitar').baseFret, 6);
});
