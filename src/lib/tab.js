// Guitar tab for a melody, and the plain-text sheet (ChordPro) that holds
// the chords, note names and tab read from printed music. Pure, no DOM.
import { noteName, prefersFlats } from './chords.js';

// Standard tuning, highest string first, as the notes guitar music is
// written at (an octave above how a guitar sounds).
const STRINGS = [{ name: 'e', open: 76 }, { name: 'B', open: 71 }, { name: 'G', open: 67 }, { name: 'D', open: 62 }, { name: 'A', open: 57 }, { name: 'E', open: 52 }];
const MAX_FRET = 15;

const positions = (midi) => STRINGS.map((s, string) => ({ string, fret: midi - s.open })).filter((p) => p.fret >= 0 && p.fret <= MAX_FRET);

/**
 * Picks a string and fret for each note so the hand moves as little as it
 * can and stays low on the neck. Notes out of the guitar's range are moved
 * by octaves until they fit (and marked `octave`).
 * notes: [{ midi }] -> [{ string, fret, octave }]
 */
export function fretNotes(notes) {
  const options = notes.map((n) => {
    let midi = n.midi, octave = 0;
    while (!positions(midi).length && midi < STRINGS[5].open) { midi += 12; octave++; }
    while (!positions(midi).length && midi > STRINGS[0].open + MAX_FRET) { midi -= 12; octave--; }
    return positions(midi).map((p) => ({ ...p, octave }));
  });
  // Cheapest path through the choices (dynamic programming).
  const cost = (p) => 0.12 * p.fret + (p.fret > 0 && p.fret < 5 ? 0 : p.fret === 0 ? 0.05 : 0.1);
  const move = (a, b) => {
    const fa = a.fret || null, fb = b.fret || null;
    const reach = fa && fb ? Math.max(0, Math.abs(fa - fb) - 3) * 1.0 + Math.abs(fa - fb) * 0.15 : 0;
    return reach + 0.08 * Math.abs(a.string - b.string);
  };
  const table = [];
  options.forEach((opts, i) => {
    table.push(opts.map((p) => {
      if (!i || !table[i - 1].length) return { p, total: cost(p), from: -1 };
      let best = null;
      table[i - 1].forEach((prev, k) => {
        const total = prev.total + move(prev.p, p) + cost(p);
        if (!best || total < best.total) best = { p, total, from: k };
      });
      return best;
    }));
  });
  const out = new Array(notes.length).fill(null);
  let k = -1;
  for (let i = notes.length - 1; i >= 0; i--) {
    const row = table[i];
    if (!row.length) { k = -1; continue; }
    if (k < 0) k = row.reduce((b, cell, j) => (cell.total < row[b].total ? j : b), 0);
    out[i] = row[k].p;
    k = row[k].from;
  }
  return out;
}

/**
 * Lays bars out as rows of tab text.
 * measures: [{ length, melody: [{ midi, time, duration, name }], chords: [{ name, time }] }]
 * Returns rows: [{ chords: [{ column, name }], notes: string, lines: string[6] }].
 */
export function tabRows(measures, { width = 72, key = null } = {}) {
  // Guitar music is written an octave above how it sounds. Music already in
  // the guitar's clef (treble with an 8) is read at its sounding pitch, so it
  // goes back up; anything else is played as written.
  const melody = measures.flatMap((m) => m.melody).map((n) => ({ midi: n.clef === 'treble8' ? n.midi + 12 : n.midi }));
  const frets = fretNotes(melody);
  let n = 0;
  const flats = key ? prefersFlats(key) : false;
  const bars = measures.map((m) => {
    // Columns per beat: enough room for two-digit frets on short notes.
    const shortest = Math.min(1, ...m.melody.map((x) => x.duration));
    const perBeat = Math.max(4, Math.ceil(3 / shortest));
    const span = Math.max(3, Math.round(Math.max(m.length, ...m.melody.map((x) => x.time + x.duration)) * perBeat));
    const strings = STRINGS.map(() => Array(span + 1).fill('-'));
    const names = Array(span + 1).fill(' ');
    for (const note of m.melody) {
      const at = Math.min(span - 1, Math.round(note.time * perBeat) + 1);
      const pos = frets[n++];
      if (!pos) continue;
      const digits = String(pos.fret);
      for (let d = 0; d < digits.length; d++) strings[pos.string][at + d] = digits[d];
      const name = noteName(note.midi, flats);
      for (let d = 0; d < name.length; d++) names[at + d] = name[d];
    }
    return {
      width: span + 1,
      strings: strings.map((s) => s.join('')),
      notes: names.join(''),
      chords: m.chords.map((c) => ({ column: Math.round(c.time * perBeat) + 1, name: c.name })),
    };
  });
  const rows = [];
  let row = null;
  for (const bar of bars) {
    if (!row || row.width + bar.width + 1 > width) {
      row = { width: 2, chords: [], notes: '  ', lines: STRINGS.map((s) => `${s.name}|`) };
      rows.push(row);
    }
    for (const c of bar.chords) row.chords.push({ column: row.width + c.column, name: c.name });
    row.notes += bar.notes + ' ';
    row.lines = row.lines.map((line, i) => `${line}${bar.strings[i]}|`);
    row.width += bar.width + 1;
  }
  return rows;
}

// A row of chord names at given columns, written with ChordPro brackets so
// the chords stay chords (they can be transposed) inside a tab block.
function chordLine(chords) {
  let plain = 0, text = '';
  for (const c of chords) {
    // Once laid out, "[G]" takes up only the width of "G".
    const at = Math.max(c.column, plain + (text ? 1 : 0));
    text += ' '.repeat(at - plain) + `[${c.name}]`;
    plain = at + c.name.length;
  }
  return text;
}

/**
 * The whole sheet as ChordPro: title, key and time, then for each line of
 * music the chords, the note names and the tab.
 */
export function sheetText(result, { title = '', width = 72 } = {}) {
  const { key, beats } = result;
  const keyText = key ? noteName(key.index, prefersFlats(key)) + (key.minor ? 'm' : '') : '';
  const time = { 2: '2/4', 3: '3/4', 4: '4/4', 6: '6/8' }[beats] || '';
  const lines = [];
  if (title) lines.push(`{title: ${title}}`);
  if (keyText) lines.push(`{key: ${keyText}}`);
  if (time) lines.push(`{time: ${time}}`);
  lines.push('');
  const bySystem = new Map();
  for (const m of result.measures) {
    if (!bySystem.has(m.system)) bySystem.set(m.system, []);
    bySystem.get(m.system).push(m);
  }
  let number = 0;
  for (const measures of bySystem.values()) {
    for (const row of tabRows(measures, { width, key })) {
      lines.push(`{start_of_tab: Line ${++number}}`);
      if (row.chords.length) lines.push(chordLine(row.chords));
      lines.push(row.notes.trimEnd());
      lines.push(...row.lines);
      lines.push('{end_of_tab}', '');
    }
  }
  return lines.join('\n').replace(/\n+$/, '\n');
}
