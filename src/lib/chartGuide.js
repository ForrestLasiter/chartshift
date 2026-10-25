// Hand-written chord charts of hymns: moving their chords onto a hymn's
// tune, so every verse gets the same chords, and tidying charts whose later
// verses were run together. Pure, no DOM.
import { transposeChord } from './chords.js';

const EPS = 1e-6;
const wordKey = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const HEADING = /^(verse|chorus|refrain|bridge|coda|outro|ending|tag|interlude)\s*(\d*)\s*:?$/i;

/** Rough syllable count of an English word, for words with no notes to go by. */
export function syllableCount(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

// One line of a chart as words, each with the chords written in it and how
// far into the word each sits (0 to 1).
function wordsOfLine(line) {
  const words = [];
  let word = null, pending = [];
  const flush = () => { if (word) words.push(word); word = null; };
  for (let i = 0; i < line.length;) {
    if (line[i] === '[') {
      const end = line.indexOf(']', i);
      if (end < 0) break;
      pending.push(line.slice(i + 1, end));
      i = end + 1;
      continue;
    }
    if (/\s/.test(line[i])) { flush(); i++; continue; }
    if (!word) word = { text: '', chords: [] };
    for (const name of pending) word.chords.push({ name, at: word.text.length });
    pending = [];
    word.text += line[i++];
  }
  // A chord after the last word of a line goes on that word's end.
  if (pending.length && word) for (const name of pending) word.chords.push({ name, at: word.text.length });
  flush();
  return words.map((w) => ({ text: w.text, chords: w.chords.map((c) => ({ name: c.name, share: w.text.length ? c.at / w.text.length : 0 })) }));
}

/**
 * A chart in sections: [{ heading, kind, lines }]. Lines before any heading
 * are the first verse; directives ({c: ...}) are left out.
 */
export function chartSections(chordPro) {
  const sections = [];
  let current = null;
  for (const raw of String(chordPro).replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (/^\{.*\}$/.test(line)) continue;
    const heading = HEADING.exec(line);
    if (heading) {
      const kind = /^(chorus|refrain)$/i.test(heading[1]) ? 'chorus' : heading[1].toLowerCase();
      current = { heading: line.replace(/:$/, ''), kind, lines: [] };
      sections.push(current);
      continue;
    }
    if (!line) continue;
    if (!current) { current = { heading: 'Verse 1', kind: 'verse', lines: [] }; sections.push(current); }
    current.lines.push(line);
  }
  return sections.filter((s) => s.lines.length);
}

// The words of a chart's first verse and first chorus (`starts`: the word
// begins a line of the chart).
function guideWords(chordPro) {
  const sections = chartSections(chordPro);
  const verse = sections.find((s) => s.kind === 'verse');
  const chorus = sections.find((s) => s.kind === 'chorus');
  return [verse, chorus].filter(Boolean).flatMap((s) => s.lines.flatMap((line) => wordsOfLine(line).map((w, i) => ({ ...w, starts: i === 0 }))))
    .map((w) => ({ key: wordKey(w.text), chords: w.chords, starts: w.starts })).filter((w) => w.key);
}

// Lines up two lists of words (two printings of the same verse): for each
// word of `a`, the index of the same word in `b`, or -1.
function alignWords(a, b) {
  const n = a.length, m = b.length;
  const same = (x, y) => x === y || (x.length > 3 && y.length > 3 && (x.startsWith(y) || y.startsWith(x)));
  const score = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    score[i][j] = same(a[i], b[j]) ? score[i + 1][j + 1] + 1 : Math.max(score[i + 1][j], score[i][j + 1]);
  }
  const map = new Array(n).fill(-1);
  for (let i = 0, j = 0; i < n && j < m;) {
    if (same(a[i], b[j])) { map[i] = j; i++; j++; } else if (score[i + 1][j] >= score[i][j + 1]) i++; else j++;
  }
  return { map, matched: score[0][0] };
}

/**
 * The chords of a hand-written chart moved onto the tune: each takes the time
 * of the syllable it was written over. `sung`: the tune's first verse and
 * refrain as [{ text, time, joinsNext }]. Returns [{ time, name }], or null
 * when the chart's words do not fit the tune.
 */
export function chordsFromChart(chordPro, sung, { shift = 0, flats = false } = {}) {
  const guide = guideWords(chordPro);
  const words = [];
  let word = null;
  for (const s of sung) {
    if (!word) { word = { text: '', syllables: [] }; words.push(word); }
    word.syllables.push({ from: word.text.length, time: s.time });
    word.text += s.text;
    if (!s.joinsNext) word = null;
  }
  const keys = words.map((w) => wordKey(w.text));
  const { map, matched } = alignWords(guide.map((g) => g.key), keys);
  const written = guide.reduce((n, g) => n + g.chords.length, 0);
  if (!written || matched < 0.6 * Math.min(guide.length, keys.length)) return null;
  const out = [];
  guide.forEach((g, i) => {
    if (!g.chords.length) return;
    let j = map[i];
    // A chord on a word the tune spells differently: the next word that fits.
    for (let k = i + 1; j < 0 && k < guide.length; k++) j = map[k];
    if (j < 0) return;
    const w = words[j];
    for (const c of g.chords) {
      const at = c.share * w.text.length;
      const syllable = [...w.syllables].reverse().find((s) => s.from <= at + 0.5) || w.syllables[0];
      out.push({ time: syllable.time, name: shift ? transposeChord(c.name, shift, flats) : c.name });
    }
  });
  if (out.length < 0.6 * written) return null;
  out.sort((a, b) => a.time - b.time);
  // Two chords on one syllable: the later one written is the one played.
  const chords = out.filter((c, k) => k === out.length - 1 || out[k + 1].time > c.time + EPS);
  // Where the chart starts its lines, as moments in the tune: every verse
  // can be broken at the same places.
  chords.breaks = guide.flatMap((g, i) => (g.starts && map[i] >= 0 ? [words[map[i]].syllables[0].time] : []));
  return chords;
}

/**
 * A chart tidied for singing from: the first verse and the first chorus as
 * written; each later verse, where it was run together (lines of the wrong
 * length, the chorus pasted on its end), set out again line for line like
 * the first verse, with the first verse's chords on the same syllables.
 * Repeats of the chorus after the first are left out.
 */
export function tidyChart(chordPro) {
  const sections = chartSections(chordPro);
  const first = sections.find((s) => s.kind === 'verse');
  const chorus = sections.find((s) => s.kind === 'chorus');
  if (!first) return sections;
  // The first verse's shape: syllables per line, and the chord (if any)
  // starting on each syllable.
  const shape = [];
  const pattern = [];
  for (const line of first.lines) {
    let count = 0;
    for (const w of wordsOfLine(line)) {
      const n = syllableCount(w.text) || 1;
      const at = new Array(n).fill(null);
      for (const c of w.chords) at[Math.min(n - 1, Math.floor(c.share * n))] = c.name;
      pattern.push(...at);
      count += n;
    }
    shape.push(count);
  }
  const longest = Math.max(...first.lines.map((l) => l.replace(/\[[^\]]*\]/g, '').length));
  const chorusKeys = chorus ? chorus.lines.flatMap(wordsOfLine).map((w) => wordKey(w.text)).filter(Boolean) : [];
  const out = [];
  let choruses = 0;
  for (const section of sections) {
    if (section.kind === 'chorus' && choruses++) continue;
    if (section.kind !== 'verse' || section === first) { out.push(section); continue; }
    let words = section.lines.flatMap(wordsOfLine).map((w) => w.text).filter((t) => wordKey(t));
    // The chorus pasted on the end of the verse.
    if (chorusKeys.length >= 4) {
      const keys = words.map(wordKey);
      const start = keys.findIndex((k, i) => chorusKeys.slice(0, 4).every((c, j) => keys[i + j] === c));
      if (start > 0) words = words.slice(0, start);
    }
    const plainLines = section.lines.map((l) => l.replace(/\[[^\]]*\]/g, ''));
    const runTogether = section.lines.length !== first.lines.length || plainLines.some((l) => l.length > 1.3 * longest) || words.length < section.lines.flatMap(wordsOfLine).length;
    if (!runTogether) { out.push(section); continue; }
    // Set it out again like the first verse.
    const lines = [];
    let line = [], lineIndex = 0, inLine = 0, k = 0, last = null;
    for (const word of words) {
      const n = syllableCount(word) || 1;
      const name = pattern.slice(k, k + n).filter(Boolean)[0];
      k += n;
      line.push(name && name !== last ? `[${name}]${word}` : word);
      if (name) last = pattern.slice(k - n, k).filter(Boolean).pop();
      inLine += n;
      if (lineIndex < shape.length - 1 && inLine >= shape[lineIndex]) { lines.push(line.join(' ')); line = []; inLine = 0; lineIndex++; }
    }
    if (line.length) lines.push(line.join(' '));
    out.push({ ...section, lines });
  }
  return out;
}

/** Sections back to chart text. */
export const sectionsText = (sections) => sections.map((s) => [s.heading, ...s.lines].join('\n')).join('\n\n') + '\n';
