// The free hymn library: reading hymns in ABC, making their chord charts,
// moving hand-written chords onto the tune, and finding songs by a church's
// own hymnal numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseAbc, parseKey, alignLyrics } from '../src/lib/abc.js';
import { hymnChart } from '../src/lib/hymn.js';
import { chordsFromChart, tidyChart, sectionsText } from '../src/lib/chartGuide.js';
import { findHymns, matchIndex, parseIndex, titleLikeness } from '../src/lib/hymnIndex.js';

// A short hymn in four parts (two staffs, two voices each), two verses.
const HYMN = `X: 1
T: Test Hymn
M: 3/4
L: 1/4
%%staves (S1V1 S1V2) | (S2V1 S2V2)
V: S1V1 clef=treble
V: S1V2
V: S2V1 clef=bass
V: S2V2
K: G
[V: S1V1] D | G2 B/G/ | B2 A | G2 E | D2 |]
w: 1.~A- maz- ing * grace! How sweet the sound
w: 2.~'Twas grace that * taught my heart to fear
[V: S1V2] B, | B,2 D | D2 C | B,2 C | B,2 |]
[V: S2V1] G, | D,2 G, | G,2 F, | G,2 G, | G,2 |]
[V: S2V2] G,, | G,,2 G,,/B,,/ | D,2 D, | E,2 C, | G,,2 |]
`;

test('ABC: key, time, parts and notes in time', () => {
  const tune = parseAbc(HYMN);
  assert.equal(tune.title, 'Test Hymn');
  assert.deepEqual(tune.meter, { num: 3, den: 4 });
  assert.equal(tune.key.fifths, 1);
  assert.deepEqual(tune.order, ['S1V1', 'S1V2', 'S2V1', 'S2V2']);
  const tuneNotes = tune.voices.get('S1V1').events;
  assert.equal(tuneNotes[0].midi[0], 62); // D above middle C
  assert.equal(tuneNotes[1].duration, 0.5); // G2 with L:1/4 is a half note
  assert.equal(tuneNotes[2].duration, 0.125); // B/
  for (const id of tune.order) {
    const last = tune.voices.get(id).events.at(-1);
    assert.equal(last.time + last.duration, 3, `${id} ends with the others`);
  }
  assert.deepEqual(parseKey('Em'), { fifths: 1, tonic: 4, minor: true });
  assert.equal(parseKey('Bb').fifths, -2);
});

test('ABC: verse syllables line up with the notes (* skips one)', () => {
  const tune = parseAbc(HYMN);
  const v = tune.voices.get('S1V1');
  const seg = v.segments[0];
  const syllables = alignLyrics(seg.lyrics[0], v.events.slice(seg.from, seg.to), v.bars);
  assert.deepEqual(syllables.map((s) => s.text), ['1. A', 'maz', 'ing', 'grace!', 'How', 'sweet', 'the', 'sound']);
  assert.equal(syllables[3].note, 4); // "grace" skips the G after "ing"
  assert.ok(syllables[0].joinsNext && syllables[1].joinsNext && !syllables[2].joinsNext);
});

test('a hymn becomes a verse-by-verse chord chart', () => {
  const { text, verses } = hymnChart(HYMN);
  assert.equal(verses, 2);
  assert.match(text, /\{key: G\}/);
  assert.match(text, /\{time: 3\/4\}/);
  assert.match(text, /Verse 1\n\[G\]Amazing/);
  assert.match(text, /Verse 2\n\[G\]'Twas grace/);
  assert.ok(!/1\. /.test(text), 'verse numbers are taken off the words');
});

test('hand-written chords are moved onto every verse', () => {
  const chart = 'Verse 1\nA[G]mazing grace! How [C]sweet the [D]sound\n';
  const { text, guided } = hymnChart(HYMN, { chart, chartKey: 'G' });
  assert.ok(guided);
  assert.match(text, /Verse 1\nA\[G\]mazing grace! How \[C\]sweet the \[D\]sound/);
  assert.match(text, /Verse 2\n'Twas \[G\]grace that taught my \[C\]heart to \[D\]fear/);
  // A chart in another key is put into the hymn's key.
  const inA = hymnChart(HYMN, { chart: 'Verse 1\nA[A]mazing grace! How [D]sweet the [E]sound\n', chartKey: 'A' });
  assert.match(inA.text, /How \[C\]sweet the \[D\]sound/);
  // Words that do not fit the tune are not used.
  assert.equal(chordsFromChart('Verse 1\n[G]Something else [C]entirely here\n', [{ text: 'A', time: 0, joinsNext: true }, { text: 'maz', time: 1 }]), null);
});

test('a chart whose later verses ran together is set out like the first', () => {
  const chart = [
    'Verse 1', '[G]On a hill far away stood an [C]old rugged cross,', 'the emblem of [D]suffering and [G]shame;', '',
    'Chorus', 'So I\'ll [D]cherish the old rugged [G]cross,', '',
    'Verse 2', 'O that old rugged cross, so despised by the world, Has a wondrous attraction for me; So I\'ll cherish the old rugged cross,', '',
    'Chorus', 'So I\'ll [D]cherish the old rugged [G]cross,',
  ].join('\n');
  const sections = tidyChart(chart);
  assert.deepEqual(sections.map((s) => s.heading), ['Verse 1', 'Chorus', 'Verse 2']);
  const verse2 = sections[2].lines;
  assert.equal(verse2.length, 2);
  assert.ok(!verse2.join(' ').includes('cherish'), 'the pasted chorus is taken off');
  assert.match(verse2[0], /^\[G\]O that/);
  assert.match(sectionsText(sections), /^Verse 1\n/);
});

test('a hymnal index is read and matched to the library', () => {
  const entries = parseIndex([
    'Amazing Grace .......... 209',
    'Blessed Assurance............. 14',
    "I'll Fly Away 46    It Is Well with My Soul 410",
    '212 The Old Rugged Cross',
    'Holy, Holy, Holy! Lord God Almighty, 1',
  ].join('\n'));
  assert.deepEqual(entries.map((e) => e.number), ['209', '14', '46', '410', '212', '1']);
  assert.equal(entries[2].title, "I'll Fly Away");
  const hymns = [
    { id: 'a', title: 'Amazing Grace', firstLine: 'Amazing grace! How sweet the sound' },
    { id: 'b', title: 'Blessed Assurance', firstLine: 'Blessed assurance, Jesus is mine' },
    { id: 'c', title: 'It Is Well with My Soul', firstLine: 'When peace like a river attendeth my way' },
    { id: 'd', title: 'The Old Rugged Cross', firstLine: 'On a hill far away' },
    { id: 'e', title: 'Holy, Holy, Holy', firstLine: 'Holy, holy, holy! Lord God Almighty' },
  ];
  const book = { name: 'Our Hymnal', entries: matchIndex(entries, hymns) };
  assert.deepEqual(book.entries.map((e) => e.hymn), ['a', 'b', null, 'c', 'd', 'e']);
  assert.equal(findHymns('209', hymns, book)[0].hymn.id, 'a');
  assert.deepEqual(findHymns('46', hymns, book), [{ hymn: null, number: '46', title: "I'll Fly Away" }]);
  assert.equal(findHymns('rugged', hymns, book)[0].number, '212');
  assert.ok(titleLikeness('Amazng Grace', 'Amazing Grace') > 0.9, 'an OCR slip still matches');
});

test('the bundled hymn library', () => {
  const { hymns } = JSON.parse(fs.readFileSync(new URL('../public/hymnal/hymns.json', import.meta.url), 'utf8'));
  assert.ok(hymns.length >= 500, `${hymns.length} songs`);
  const ids = new Set();
  for (const h of hymns) {
    assert.ok(!ids.has(h.id), `${h.id} once`);
    ids.add(h.id);
    assert.ok(h.title && h.chart.includes('{title:'), `${h.id} has a title`);
    assert.ok(/Verse|Chorus/.test(h.chart), `${h.id} has verses`);
    assert.ok(/^(Public domain|.+ · CC )/.test(h.credit), `${h.id} may be shared: ${h.credit}`);
  }
  const grace = hymns.find((h) => h.title === 'Amazing Grace');
  assert.match(grace.chart, /Verse 2\n.*\[[A-G]/, 'later verses have chords');
  assert.match(grace.chart, /'Twas/);
});
