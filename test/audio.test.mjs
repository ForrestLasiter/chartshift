// Chords from a recording. The "recordings" here are synthesised: plucked
// strings with overtones, strummed in guitar voicings. That checks the method,
// not how it copes with a real room, a real guitar or a phone microphone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chordsToText, clock, detectChords, keyOfChords, prepare } from '../src/lib/audioChords.js';

const RATE = 44100;
// Guitar voicings as MIDI notes, low to high.
const VOICINGS = {
  G: [43, 47, 50, 55, 59, 67], C: [48, 52, 55, 60, 64], D: [50, 57, 62, 66], Em: [40, 47, 52, 55, 59, 64],
  Am: [45, 52, 57, 60, 64], F: [41, 48, 53, 57, 60, 65], A: [45, 52, 57, 61, 64], E: [40, 47, 52, 56, 59, 64],
  Dm: [50, 57, 62, 65], Bm: [47, 54, 59, 62, 66], Bb: [46, 53, 58, 62, 65], Eb: [51, 58, 63, 67], 'F#m': [42, 49, 54, 57, 61, 66],
  G7: [43, 47, 50, 55, 59, 65], Dsus4: [50, 57, 62, 67],
};

// Deterministic noise, so the tests always see the same "recording".
let seed = 12345;
const noise = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };

/** song: [[chord or null for silence, seconds], …]. Each chord is strummed twice a second. */
function play(song, { cents = 0, noiseLevel = 0.01, rate = RATE } = {}) {
  const total = song.reduce((sum, [, seconds]) => sum + seconds, 0);
  const out = new Float32Array(Math.round(total * rate));
  let offset = 0;
  for (const [chord, seconds] of song) {
    const length = Math.round(seconds * rate);
    if (chord) {
      for (const [n, midi] of VOICINGS[chord].entries()) {
        const hz = 440 * 2 ** ((midi - 69 + cents / 100) / 12);
        for (let i = 0; i < length; i++) {
          const t = i / rate;
          const sinceStrum = (t % 0.5) - n * 0.012; // strings sound one after another
          if (sinceStrum < 0) continue;
          const fade = Math.exp(-sinceStrum * 3);
          let s = 0;
          for (let h = 1; h <= 6; h++) s += 0.6 ** (h - 1) * Math.sin(2 * Math.PI * hz * h * t);
          out[offset + i] += 0.08 * fade * s;
        }
      }
    }
    for (let i = 0; i < length; i++) out[offset + i] += noiseLevel * noise();
    offset += length;
  }
  return out;
}
const names = (result) => result.chords.map((c) => c.name);

test('a simple progression is read back in order with sensible timing', () => {
  const result = detectChords(play([['G', 2], ['C', 2], ['D', 2], ['Em', 2], ['C', 2], ['G', 2]]), RATE);
  assert.deepEqual(names(result), ['G', 'C', 'D', 'Em', 'C', 'G']);
  result.chords.forEach((chord, i) => {
    assert.ok(Math.abs(chord.start - i * 2) < 0.45, `${chord.name} starts near ${i * 2}s (got ${chord.start})`);
  });
  assert.equal(Math.round(result.duration), 12);
  assert.deepEqual(result.key, { index: 7, minor: false });
});

test('major and minor chords on the same root are told apart', () => {
  assert.deepEqual(names(detectChords(play([['A', 2], ['Am', 2], ['E', 2], ['Em', 2], ['D', 2], ['Dm', 2]]), RATE)), ['A', 'Am', 'E', 'Em', 'D', 'Dm']);
});

test('other keys, including flat keys, are named properly', () => {
  const flat = detectChords(play([['F', 2], ['Bb', 2], ['C', 2], ['Dm', 2], ['Bb', 2], ['F', 2]]), RATE);
  assert.deepEqual(names(flat), ['F', 'Bb', 'C', 'Dm', 'Bb', 'F']);
  assert.deepEqual(flat.key, { index: 5, minor: false });
  const sharp = detectChords(play([['A', 2], ['D', 2], ['E', 2], ['F#m', 2], ['D', 2], ['A', 2]]), RATE);
  assert.deepEqual(names(sharp), ['A', 'D', 'E', 'F#m', 'D', 'A']);
  const minor = detectChords(play([['Am', 2], ['F', 2], ['C', 2], ['G', 2], ['Am', 2]]), RATE);
  assert.deepEqual(names(minor), ['Am', 'F', 'C', 'G', 'Am']);
  assert.deepEqual(minor.key, { index: 9, minor: true });
});

test('an instrument tuned a little sharp or flat is still read correctly', () => {
  for (const cents of [30, -35]) {
    const result = detectChords(play([['G', 2], ['C', 2], ['D', 2], ['Em', 2]], { cents }), RATE);
    assert.deepEqual(names(result), ['G', 'C', 'D', 'Em'], `${cents} cents`);
    assert.ok(Math.abs(result.tuning - cents) <= 8, `tuning measured as ${result.tuning} cents for ${cents}`);
  }
});

test('quick changes are followed and silence is left empty', () => {
  const quick = detectChords(play([['G', 1], ['D', 1], ['Em', 1], ['C', 1], ['G', 1], ['D', 1], ['C', 2]]), RATE);
  assert.deepEqual(names(quick), ['G', 'D', 'Em', 'C', 'G', 'D', 'C']);
  const gaps = detectChords(play([[null, 1.5], ['G', 2], ['C', 2], [null, 4], ['D', 2], ['G', 2]]), RATE);
  assert.deepEqual(names(gaps), ['G', 'C', 'D', 'G']);
  assert.ok(gaps.chords[0].start > 1 && gaps.chords[2].start - gaps.chords[1].end > 3, 'the silences are not filled with chords');
  assert.deepEqual(detectChords(play([[null, 3]]), RATE).chords, []);
  assert.deepEqual(detectChords(new Float32Array(100), RATE).chords, []);
});

test('noisy recordings and other sample rates still work', () => {
  assert.deepEqual(names(detectChords(play([['G', 2], ['C', 2], ['D', 2], ['G', 2]], { noiseLevel: 0.12 }), RATE)), ['G', 'C', 'D', 'G']);
  assert.deepEqual(names(detectChords(play([['G', 2], ['Em', 2], ['C', 2], ['D', 2]], { rate: 48000 }), 48000)), ['G', 'Em', 'C', 'D']);
  assert.deepEqual(names(detectChords(play([['C', 2], ['Am', 2], ['F', 2], ['G', 2]], { rate: 16000 }), 16000)), ['C', 'Am', 'F', 'G']);
  assert.equal(prepare(new Float32Array(44100), 44100).sampleRate, 11025);
});

test('richer chords are reported as the plain chord they are built on', () => {
  assert.deepEqual(names(detectChords(play([['C', 2], ['G7', 2], ['C', 2], ['Dsus4', 2], ['D', 2]]), RATE)).filter((n, i, a) => n !== a[i - 1]), ['C', 'G', 'C', 'D']);
});

test('the key is chosen from the chords, favouring the home chord', () => {
  const chord = (root, minor, seconds = 2) => ({ root, minor, seconds });
  assert.deepEqual(keyOfChords([chord(7, false), chord(0, false), chord(2, false), chord(7, false)]), { index: 7, minor: false });
  assert.deepEqual(keyOfChords([chord(4, true), chord(0, false), chord(7, false), chord(2, false), chord(4, true)]), { index: 4, minor: true });
  assert.equal(keyOfChords([]), null);
});

test('chords become song text, a few to a line, with breaks at pauses', () => {
  const chords = ['G', 'C', 'G', 'D', 'Em', 'C'].map((name, i) => ({ name, start: i * 2, end: i * 2 + 2 }));
  assert.equal(chordsToText(chords), '[G] [C] [G] [D]\n[Em] [C]');
  chords.push({ name: 'Am', start: 20, end: 22 }, { name: 'D', start: 22, end: 24 });
  assert.equal(chordsToText(chords), '[G] [C] [G] [D]\n[Em] [C]\n\n[Am] [D]');
  assert.equal(chordsToText(chords, { perLine: 8 }), '[G] [C] [G] [D] [Em] [C]\n\n[Am] [D]');
  assert.equal(chordsToText([]), '');
  assert.equal(clock(65.4), '1:05');
});
