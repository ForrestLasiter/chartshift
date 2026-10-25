// A chord chart from a hymnal page: the verses printed under the music,
// read as rows of words, with the chords worked out from the music placed
// over the syllables sung where they change. Each verse becomes a section.
// Pure, no DOM.
import { noteName, prefersFlats } from './chords.js';

const TIMES = { 2: '2/4', 3: '3/4', 4: '4/4', 6: '6/8' };
const LETTERS = /[A-Za-z]/;

// Height of a staff's top or bottom line at x (page points), following its curve.
function lineAt(points, x, scale) {
  const px = x * scale;
  if (!points || !points.length) return null;
  if (px <= points[0][0]) return points[0][1] / scale;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1], [x1, y1] = points[i];
    if (px <= x1) return (y0 + ((px - x0) / (x1 - x0 || 1)) * (y1 - y0)) / scale;
  }
  return points[points.length - 1][1] / scale;
}

/**
 * The words of one line of music, in rows (one per verse): those between the
 * staffs of its system, or below its staff when it has only one. On a photo
 * the words curve with the page, so each word is measured from the staff
 * above it at its own place across the page, and words at the same distance
 * below the staff form a row.
 * `rows`: [{ base, tokens: [{ text, x0, x1, y0, y1, base }] }] in page points.
 */
function lyricRows(music, systemIndex, rows, scale) {
  const sys = music.systems[systemIndex];
  const staffs = sys.staffs.map((i) => music.staffs[i]);
  const above = staffs[0];
  const below = staffs.length > 1 ? staffs[staffs.length - 1] : music.systems[systemIndex + 1] && music.staffs[music.systems[systemIndex + 1].staffs[0]];
  const space = above.space / scale;
  const left = sys.x0 / scale - 2 * space, right = sys.x1 / scale + 2 * space;
  const words = [];
  for (const row of rows) {
    for (const t of row.tokens) {
      const x = (t.x0 + t.x1) / 2;
      if (x < left || x > right) continue;
      const base = t.base ?? row.base;
      const from = lineAt(above.bottomAt, x, scale) ?? above.lines[4] / scale;
      const to = below ? (lineAt(below.topAt, x, scale) ?? below.lines[0] / scale) : Infinity;
      if (base < from + 1.5 * space || base > to - 1.2 * space) continue;
      if (!(LETTERS.test(t.text) || /^[-–]+$/.test(t.text) || /^\d+\.?$/.test(t.text))) continue;
      words.push({ ...t, depth: base - from, height: t.y1 - t.y0 });
    }
  }
  // Words the OCR read as one line of text belong together: each takes the
  // middle depth of its line, which evens out the wobble of single words.
  const byLine = new Map();
  for (const w of words) if (w.line != null) { if (!byLine.has(w.line)) byLine.set(w.line, []); byLine.get(w.line).push(w.depth); }
  for (const w of words) if (w.line != null) { const d = byLine.get(w.line).sort((a, b) => a - b); w.depth = d[d.length >> 1]; }
  words.sort((a, b) => a.depth - b.depth);
  const out = [];
  for (const w of words) {
    const row = out[out.length - 1];
    if (row && w.depth - row.depth < 0.6 * space) {
      row.tokens.push(w);
      row.depth = (row.depth * (row.tokens.length - 1) + w.depth) / row.tokens.length;
    } else out.push({ depth: w.depth, height: w.height, tokens: [w] });
  }
  for (const row of out) row.tokens.sort((a, b) => a.x0 - b.x0);
  return out.filter((row) => row.tokens.filter((t) => LETTERS.test(t.text)).length >= 2);
}

// One row of words as syllables: { text, x (centre), joinsNext } — a syllable
// followed by a hyphen is joined to the next one without a space.
function syllablesOf(row) {
  const out = [];
  let number = null;
  row.tokens.forEach((t, i) => {
    // Only letters and ordinary punctuation: a stray "[" from the OCR would
    // otherwise read as a chord bracket in the song's text.
    let text = t.text.trim().replace(/[^\p{L}\p{N}'’,.;:!?–-]/gu, '');
    if (!text) return;
    // "1." at the start of a row is the verse number (read as "l." at times,
    // or run together with the first word: "1.A").
    if (i === 0) {
      const m = text.match(/^([0-9lI])\.\s*(.*)$/) || text.match(/^(\d+)$/);
      if (m) { number = /\d/.test(m[1]) ? Number(m[1]) : 1; text = m[2] || ''; if (!text) return; }
    }
    if (/^[-–]+$/.test(text)) { if (out.length) out[out.length - 1].joinsNext = true; return; }
    // A lone "1" or "l" among the words is the word "I" misread.
    if (/^[1l]$/.test(text)) text = 'I';
    const lead = /^[-–]/.test(text), trail = /[-–]$/.test(text);
    text = text.replace(/^[-–]+|[-–]+$/g, '');
    if (!text) return;
    if (lead && out.length) out[out.length - 1].joinsNext = true;
    out.push({ text, x: (t.x0 + t.x1) / 2, x0: t.x0, joinsNext: trail });
  });
  return { number, syllables: out };
}

/**
 * Lays one row of syllables out as a ChordPro line, each chord before the
 * syllable sung when it starts. chords: [{ name, x }] in page points.
 */
export function lineWithChords(syllables, chords, space) {
  const at = new Map();
  for (const chord of chords) {
    // A pickup can put a chord before the first printed word.
    if (syllables.length && chord.x < syllables[0].x - 0.5 * space) {
      if (!at.has(0)) at.set(0, []);
      at.get(0).push(chord.name);
      continue;
    }
    // The syllable under the chord's note: the nearest one, starting at or
    // just before it; if the music runs on with no new syllable (a held
    // note), the next syllable after it.
    let best = -1, bestDistance = Infinity;
    syllables.forEach((s, i) => {
      const d = Math.abs(s.x - chord.x);
      if (d < bestDistance) { bestDistance = d; best = i; }
    });
    if (best < 0) continue;
    if (bestDistance > 2 * space) {
      const next = syllables.findIndex((s) => s.x >= chord.x);
      best = next >= 0 ? next : syllables.length - 1;
    }
    if (!at.has(best)) at.set(best, []);
    at.get(best).push(chord.name);
  }
  // Keep the chord nearest the word when a pickup and its following bar
  // would otherwise stack on the first syllable.
  if (at.get(0)?.length > 1) at.set(0, [at.get(0).at(-1)]);
  // A chart names a chord where it changes, so a chord carried on from the
  // one before is not written again.
  let line = '', last = null;
  syllables.forEach((s, i) => {
    const names = (at.get(i) || []).filter((name) => { const changed = name !== last; last = name; return changed; });
    const before = names.map((name) => `[${name}]`).join('');
    line += before + s.text + (s.joinsNext || i === syllables.length - 1 ? '' : ' ');
  });
  return line;
}

/**
 * Where the words are: for each line of music, the band between its staffs
 * (or under its staff when it has only one), in the music picture's pixels.
 * Reading just these bands keeps the OCR away from the notes, which confuse it.
 */
export function lyricBands(music) {
  return music.systems.map((sys, systemIndex) => {
    const staffs = sys.staffs.map((i) => music.staffs[i]);
    const above = staffs[0];
    const below = staffs.length > 1 ? staffs[staffs.length - 1] : music.systems[systemIndex + 1] && music.staffs[music.systems[systemIndex + 1].staffs[0]];
    const sp = above.space;
    const ys = (points, fallback) => (points && points.length ? points.map((p) => p[1]) : [fallback]);
    const top = Math.max(...ys(above.bottomAt, above.lines[4])) + 1.2 * sp;
    const bottom = below ? Math.min(...ys(below.topAt, below.lines[0])) - 1.0 * sp : top + 12 * sp;
    return { system: systemIndex, x0: Math.max(0, sys.x0 - 2 * sp), x1: sys.x1 + 2 * sp, y0: top, y1: bottom };
  }).filter((band) => band.y1 - band.y0 > 1.5 * music.staffs[0].space);
}

/**
 * Places under the tune where a verse has no syllable: the words line up
 * with the melody notes, so a gap under a note is usually a short word the
 * OCR passed over ("A", "I"). Each is a box (page points) to read again,
 * with the OCR line it belongs to: [{ x0, y0, x1, y1, line, base }].
 */
export function missingSyllables({ music, result, rows, scale }) {
  const boxes = [];
  music.systems.forEach((sys, systemIndex) => {
    const space = music.staffs[sys.staffs[0]].space / scale;
    const notes = result.measures.filter((m) => m.system === systemIndex).flatMap((m) => m.melody.map((n) => n.x / scale));
    for (const row of lyricRows(music, systemIndex, rows, scale)) {
      const letters = row.tokens.filter((t) => LETTERS.test(t.text));
      const tops = letters.map((t) => t.y0).sort((a, b) => a - b), bottoms = letters.map((t) => t.y1).sort((a, b) => a - b);
      const y0 = tops[tops.length >> 1], y1 = bottoms[bottoms.length >> 1];
      const first = row.tokens[0];
      for (const x of notes) {
        // Covered: a word (or hyphen) lies under the note, or the note is
        // held on from the syllable before (a melisma) in the same word.
        if (row.tokens.some((t) => t.x0 - 0.5 * space <= x && t.x1 + 0.5 * space >= x)) continue;
        if (x < first.x0 - 3 * space) continue;
        // Find the closest words on either side and read between them.
        const left = row.tokens.filter((t) => t.x1 < x).pop(), right = row.tokens.find((t) => t.x0 > x);
        boxes.push({
          x0: Math.max(left ? left.x1 + 1 : x - 1.5 * space, x - 1.5 * space), x1: Math.min(right ? right.x0 - 1 : x + 1.5 * space, x + 1.5 * space),
          y0: y0 - 0.3 * (y1 - y0), y1: y1 + 0.3 * (y1 - y0), line: (left || right || first).line, base: row.tokens.reduce((sum, t) => sum + (t.base ?? 0), 0) / row.tokens.length,
        });
      }
    }
  });
  return boxes;
}

/**
 * The chord chart as ChordPro text, verse by verse.
 * pages: one reading per page, in order: { music (from readMusic), result
 * (from analyse), rows (OCR rows in page points), scale (the music
 * picture's pixels per point) }. A verse runs on across pages.
 * Returns '' when no verses were found under the music.
 */
export function chordChart(pages, { title = '' } = {}) {
  const verses = new Map(); // verse number -> lines
  let found = 0;
  for (const { music, result, rows, scale } of [].concat(pages)) music.systems.forEach((sys, systemIndex) => {
    const space = music.staffs[sys.staffs[0]].space / scale;
    // Plain chords read best on a chart: a major or minor seventh is shown
    // as its triad (a dominant seventh, which is part of the sound, stays).
    const chords = result.measures.filter((m) => m.system === systemIndex)
      .flatMap((m) => m.chords.map((c) => ({ name: c.name.replace(/maj7$/, '').replace(/m7$/, 'm'), x: c.x / scale })));
    lyricRows(music, systemIndex, rows, scale).forEach((row, k) => {
      const { number, syllables } = syllablesOf(row);
      if (!syllables.length) return;
      const verse = number || k + 1;
      if (!verses.has(verse)) verses.set(verse, []);
      verses.get(verse).push(lineWithChords(syllables, chords, space));
      found++;
    });
  });
  if (!found) return '';
  const first = [].concat(pages).find((p) => p.result.measures.length) || [].concat(pages)[0];
  const { key, beats } = first.result;
  const lines = [];
  if (title) lines.push(`{title: ${title}}`);
  if (key) lines.push(`{key: ${noteName(key.index, prefersFlats(key))}${key.minor ? 'm' : ''}}`);
  if (TIMES[beats]) lines.push(`{time: ${TIMES[beats]}}`);
  lines.push('');
  for (const verse of [...verses.keys()].sort((a, b) => a - b)) {
    lines.push(`Verse ${verse}`, ...verses.get(verse), '');
  }
  return lines.join('\n').replace(/\n+$/, '\n');
}
