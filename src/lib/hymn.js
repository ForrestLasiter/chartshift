// A chord chart from a hymn written out in full (ABC notation, as the Open
// Hymnal Project keeps them): the chords come from all the parts sounding
// together, the words from the verses written under the tune. Pure, no DOM.
import { parseAbc, alignLyrics } from './abc.js';
import { bestChord } from './sheet.js';
import { noteIndex, noteName, parseChord, prefersFlats } from './chords.js';
import { chordsFromChart, syllableCount } from './chartGuide.js';

const TIME = /^\d+\/\d+$/;
const EPS = 1e-6;

/** The part that carries the tune: the one with the words written under it. */
function melodyVoice(tune) {
  const lyricLines = (v) => v.segments.reduce((sum, s) => sum + s.lyrics.length, 0);
  let best = null;
  for (const id of tune.order) {
    const v = tune.voices.get(id);
    if (!v.events.length) continue;
    if (!best || lyricLines(v) > lyricLines(best)) best = v;
  }
  return best;
}

// The notes of every part sounding between two moments, each weighted by how
// long it sounds there.
function soundingIn(tune, from, to) {
  const notes = [];
  for (const v of tune.voices.values()) {
    for (const e of v.events) {
      const overlap = Math.min(to, e.time + e.duration) - Math.max(from, e.time);
      if (overlap <= EPS) continue;
      for (const midi of e.midi) notes.push({ midi, duration: overlap, start: e.time });
    }
  }
  return notes;
}

/**
 * Chords for the hymn: one a bar, or two where the harmony clearly moves
 * half way through. Returns [{ time, root, quality, name }].
 */
export function hymnChords(tune) {
  const melody = melodyVoice(tune);
  if (!melody) return [];
  const last = melody.events[melody.events.length - 1];
  const end = last.time + last.duration;
  const edges = [0, ...melody.bars.filter((b) => b > EPS && b < end - EPS), end];
  const key = { index: (((tune.key.fifths * 7) % 12) + 12) % 12, minor: false };
  const lowestAt = (notes, time) => {
    const here = notes.filter((n) => n.start <= time + EPS);
    return here.length ? Math.min(...here.map((n) => n.midi)) : null;
  };
  const chordOf = (from, to, previous) => {
    const notes = soundingIn(tune, from, to);
    return notes.length ? bestChord(notes, { key, bass: lowestAt(notes, from), previous }) : null;
  };
  const chords = [];
  let previous = null;
  for (let k = 0; k + 1 < edges.length; k++) {
    const [from, to] = [edges[k], edges[k + 1]];
    const whole = chordOf(from, to, previous);
    if (!whole) continue;
    let used = [{ chord: whole, time: from }];
    // Try a change at the note onset nearest half way through the bar.
    const onsets = [...new Set(soundingIn(tune, from, to).map((n) => n.start).filter((t) => t > from + EPS))];
    const half = (from + to) / 2;
    const split = onsets.reduce((best, t) => (best === null || Math.abs(t - half) < Math.abs(best - half) ? t : best), null);
    if (split !== null && Math.abs(split - half) <= (to - from) / 4) {
      const a = chordOf(from, split, previous), b = chordOf(split, to, a);
      const total = soundingIn(tune, from, to).reduce((sum, n) => sum + n.duration, 0);
      if (a && b && (a.root !== b.root || a.quality !== b.quality) && a.score + b.score > whole.score + 0.2 * total) {
        used = [{ chord: a, time: from }, { chord: b, time: split }];
      }
    }
    for (const { chord, time } of used) chords.push({ time, root: chord.root, quality: chord.quality });
    previous = used[used.length - 1].chord;
  }
  // The key a chart is written in: the hymn's own, minor when it says so.
  const chartKey = { index: tune.key.tonic, minor: tune.key.minor };
  // Plain chords read best on a chart: a major or minor seventh is shown as
  // its triad (a dominant seventh, part of the sound, stays).
  for (const c of chords) c.name = noteName(c.root, prefersFlats(chartKey)) + c.quality.replace(/^maj7$/, '').replace(/^m7$/, 'm');
  return chords;
}

// One line of the chart: the syllables, each chord written before the
// syllable sung when it starts (or the next one, when it changes under a
// held note). `state.last` carries the chord in force from line to line.
function chartLine(syllables, events, chords, from, to, state) {
  const at = new Map();
  for (const chord of chords) {
    if (chord.time < from - EPS || chord.time >= to - EPS) continue;
    let index = syllables.findIndex((s) => events[s.note].time >= chord.time - EPS);
    if (index < 0) index = syllables.length - 1;
    at.set(index, chord.name);
  }
  return syllables.map((s, i) => {
    const name = at.get(i);
    let text = s.text;
    if (name && name !== state.last) { text = `[${name}]${text}`; state.last = name; }
    return { text, joinsNext: s.joinsNext, time: events[s.note].time };
  });
}

// A verse's syllables as lines: broken where the hand-written chart broke
// its lines (the same places in the tune for every verse), or else at the
// ends of phrases.
function verseLines(tokens, breaks) {
  if (!breaks || !breaks.length) {
    return phraseLines([tokens.map((t) => t.text + (t.joinsNext ? '' : ' ')).join('')]);
  }
  const lines = [];
  let line = '';
  tokens.forEach((t, i) => {
    const prev = tokens[i - 1];
    if (line.trim() && prev && !prev.joinsNext && breaks.some((b) => Math.abs(b - t.time) < EPS)) { lines.push(line.trim()); line = ''; }
    line += t.text + (t.joinsNext ? '' : ' ');
  });
  if (line.trim()) lines.push(line.trim());
  return lines;
}

const VERSE_NUMBER = /^(\d+)\.\s*/;

// The lines of music break wherever the printed page ran out of room; a
// chart reads better broken at the ends of phrases (a comma, a full stop).
function phraseLines(lines) {
  const words = lines.join(' ').split(/\s+/).filter(Boolean);
  const out = [];
  let line = [];
  const plain = (w) => w.replace(/\[[^\]]*\]/g, '');
  const length = () => line.reduce((sum, w) => sum + plain(w).length + 1, 0);
  for (const word of words) {
    line.push(word);
    const n = length();
    if ((/[,;:.!?]["'’”)]*$/.test(plain(word)) && n >= 28) || n >= 70) { out.push(line.join(' ')); line = []; }
  }
  if (line.length) out.push(line.join(' '));
  return out;
}

/**
 * The hymn as a ChordPro chord chart, verse by verse.
 * @param {string} abc  the hymn in ABC notation
 * @param {{ chart?: string, chartKey?: string }} [options]  a hand-written chart
 *   of the same hymn (its first verse and chorus are enough), whose chords
 *   are used instead of working them out, and the key it is written in.
 * @returns {{ text: string, title: string, verses: number, guided: boolean }}
 */
export function hymnChart(abc, { chart = null, chartKey = null } = {}) {
  const tune = typeof abc === 'string' ? parseAbc(abc) : abc;
  const melody = melodyVoice(tune);
  const segments = melody ? melody.segments.filter((s) => s.lyrics.length) : [];
  const most = Math.max(0, ...segments.map((s) => s.lyrics.length));
  // A line of music with one line of words while the others have several
  // is a refrain, sung after every verse: it is written once, as the chorus.
  const isRefrain = (s) => most > 1 && s.lyrics.length === 1;
  // A hand-written chart's chords, when one is given and fits the tune;
  // otherwise they are worked out from the parts.
  let chords = null;
  if (chart && melody) {
    const sung = segments.flatMap((s) => alignLyrics(s.lyrics[0], melody.events.slice(s.from, s.to), melody.bars)
      .map((x) => ({ text: x.text.replace(VERSE_NUMBER, ''), joinsNext: x.joinsNext, time: melody.events[x.note + s.from].time })));
    const written = chartKey && parseChord(chartKey);
    const shift = written ? (((tune.key.tonic - noteIndex(written.root)) % 12) + 12) % 12 : 0;
    chords = chordsFromChart(chart, sung, { shift, flats: prefersFlats({ index: tune.key.tonic, minor: tune.key.minor }) });
  }
  const guided = !!chords;
  if (!chords) chords = hymnChords(tune);
  const verses = [];
  for (let v = 0; v < most; v++) {
    const state = { last: null };
    const lines = [];
    let number = v + 1;
    for (const s of segments) {
      if (isRefrain(s)) continue;
      const events = melody.events;
      const syllables = alignLyrics(s.lyrics[Math.min(v, s.lyrics.length - 1)], events.slice(s.from, s.to), melody.bars)
        .map((x) => ({ ...x, note: x.note + s.from }));
      if (!syllables.length) continue;
      const first = VERSE_NUMBER.exec(syllables[0].text);
      if (first && !lines.length) { number = Number(first[1]); syllables[0] = { ...syllables[0], text: syllables[0].text.slice(first[0].length) }; }
      lines.push({ tokens: chartLine(syllables, events, chords, s.start, s.end, state), syllables, events });
    }
    if (lines.length) verses.push({ number, lines });
  }
  let chorus = null;
  if (segments.some(isRefrain)) {
    const state = { last: null };
    chorus = verseLines(segments.filter(isRefrain).flatMap((s) => {
      const syllables = alignLyrics(s.lyrics[0], melody.events.slice(s.from, s.to), melody.bars).map((x) => ({ ...x, note: x.note + s.from }));
      return chartLine(syllables, melody.events, chords, s.start, s.end, state);
    }), chords.breaks);
  }

  // Verses printed under the music (W:), with the chords where the same
  // syllable of the first verse has them.
  const extra = [];
  let current = null;
  for (const line of tune.words) {
    if (!line.trim()) { current = null; continue; }
    const m = VERSE_NUMBER.exec(line.trim());
    if (m || !current) { current = { number: m ? Number(m[1]) : null, lines: [] }; extra.push(current); }
    current.lines.push(m ? line.trim().slice(m[0].length) : line.trim());
  }
  const pattern = []; // chord (or null) for each syllable of verse 1
  if (verses.length) {
    const seen = { last: null };
    for (const { syllables, events } of verses[0].lines) {
      for (const s of syllables) {
        const t = events[s.note].time;
        const chord = [...chords].reverse().find((c) => c.time <= t + EPS);
        const name = chord && chord.name !== seen.last ? chord.name : null;
        if (chord) seen.last = chord.name;
        pattern.push(name);
      }
    }
  }
  for (const verse of extra) {
    let k = 0, last = null;
    verse.lines = verse.lines.map((line) => line.split(/\s+/).filter(Boolean).map((word) => {
      const n = syllableCount(word);
      const name = pattern.slice(k, k + n).filter(Boolean).pop();
      k += n;
      if (name && name !== last) { last = name; return `[${name}]${word}`; }
      return word;
    }).join(' '));
  }

  const meter = tune.meter ? `${tune.meter.num}/${tune.meter.den}` : '';
  const out = [`{title: ${tune.title}}`];
  out.push(`{key: ${noteName(tune.key.tonic, prefersFlats({ index: tune.key.tonic, minor: tune.key.minor }))}${tune.key.minor ? 'm' : ''}}`);
  if (TIME.test(meter)) out.push(`{time: ${meter}}`);
  out.push('');
  const all = [...verses.map((v) => ({ number: v.number, lines: verseLines(v.lines.flatMap((l) => l.tokens), chords.breaks) })), ...extra.map((v, i) => ({ number: v.number ?? verses.length + i + 1, lines: v.lines }))];
  // The few words that lead into the chorus ("So I'll") are written at the
  // end of each verse in the score; on a chart they start the chorus.
  const plainWords = (line) => line.replace(/\[[^\]]*\]/g, '').trim();
  const tail = (lines) => (lines.length > 1 && !/[.,;:!?]["'’”)]*$/.test(plainWords(lines.at(-1))) && plainWords(lines.at(-1)).split(/\s+/).length <= 4 ? lines.at(-1) : null);
  const tails = verses.map((_, i) => tail(all[i].lines));
  if (chorus && chorus.length && tails.length && tails.every((t) => t && plainWords(t).toLowerCase() === plainWords(tails[0]).toLowerCase())) {
    chorus[0] = `${tails[0]} ${chorus[0]}`;
    verses.forEach((_, i) => all[i].lines.pop());
  } else {
    // Otherwise a stray end of a phrase goes back on the line before it.
    all.forEach((verse) => { const t = tail(verse.lines); if (t) { verse.lines.pop(); verse.lines[verse.lines.length - 1] += ` ${t}`; } });
  }
  all.forEach((verse, i) => {
    out.push(`Verse ${verse.number}`, ...verse.lines, '');
    if (i === 0 && chorus && chorus.length) out.push('Chorus', ...chorus, '');
  });
  return { text: out.join('\n').replace(/\n+$/, '\n'), title: tune.title, verses: all.length, guided };
}
