// Chord names: recognising, transposing and converting to Nashville numbers.
// Pure functions, no DOM.

const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const NATURAL = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const DEGREES = ['1', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'];
// Keys normally written with flats (major, then minor).
const FLAT_MAJOR = new Set([5, 10, 3, 8, 1, 6]);
const FLAT_MINOR = new Set([2, 7, 0, 5, 10, 3]);

const NOTE = '[A-G](?:#|b|♯|♭)?';
const CHORD_RE = new RegExp(
  `^(${NOTE})((?:maj|min|dim|aug|sus|add|m|M|\\+|-|°|ø|Δ|[0-9]|#|b|♯|♭|\\(|\\))*)(?:/(${NOTE}))?$`,
);
// Things that sit on a chord line without being chords.
const NEUTRAL_RE = /^(\||\|\||:\||\|:|%|-|–|x\d+|\d+x|\(x\d+\)|N\.?C\.?|\/+|\.+)$/i;

export function noteIndex(note) {
  let i = NATURAL[note[0]];
  if (note[1] === '#' || note[1] === '♯') i += 1;
  else if (note[1] === 'b' || note[1] === '♭') i -= 1;
  return (i + 12) % 12;
}

export function noteName(index, useFlats) {
  return (useFlats ? FLATS : SHARPS)[((index % 12) + 12) % 12];
}

// Splits "(G/B)," into wrapper punctuation and the chord itself.
function unwrap(text) {
  const lead = text.match(/^[([|]*/)[0];
  let core = text.slice(lead.length);
  // A closing bracket is only wrapping when an opening one came first: "(G)" vs "C(add9)".
  const tail = core.match(/[|,.;:]*$/)[0];
  core = core.slice(0, core.length - tail.length);
  const closer = /[([]/.test(lead) && /[)\]]$/.test(core) ? core.slice(-1) : '';
  if (closer) core = core.slice(0, -1);
  return { lead, core, tail: closer + tail };
}

export function parseChord(text) {
  if (!text) return null;
  const { lead, core, tail } = unwrap(text.trim());
  const match = core.match(CHORD_RE);
  if (!match) return null;
  // "(" inside the quality must be balanced by the quality itself, e.g. C(add9).
  const quality = match[2];
  if ((quality.match(/\(/g) || []).length !== (quality.match(/\)/g) || []).length) return null;
  return { lead, tail, root: match[1], quality, bass: match[3] || null };
}

export const isChord = (text) => !!parseChord(text);

/** Bar lines, repeat marks and the like: allowed on a chord line without being chords. */
export const isNeutral = (text) => NEUTRAL_RE.test(text);

/** True when a row of words reads as a chord line rather than lyrics. */
export function isChordLine(tokens) {
  let chords = 0, words = 0;
  for (const token of tokens) {
    if (!token || NEUTRAL_RE.test(token)) continue;
    words++;
    if (isChord(token)) chords++;
  }
  return chords > 0 && chords / words >= 0.6;
}

export function transposeChord(text, semitones, useFlats) {
  const chord = parseChord(text);
  if (!chord) return text;
  const shift = (note) => noteName(noteIndex(note) + semitones, useFlats);
  return chord.lead + shift(chord.root) + chord.quality + (chord.bass ? `/${shift(chord.bass)}` : '') + chord.tail;
}

/** Key guessed from a chord, usually the first one in the song. */
export function keyOf(text) {
  const chord = parseChord(text);
  if (!chord) return null;
  const minor = /^(m|min|-)(?!aj)/.test(chord.quality);
  return { index: noteIndex(chord.root), minor };
}

export function prefersFlats(key) {
  return (key.minor ? FLAT_MINOR : FLAT_MAJOR).has(((key.index % 12) + 12) % 12);
}

export function keyName(key) {
  return noteName(key.index, prefersFlats(key)) + (key.minor ? 'm' : '');
}

export function toNashville(text, key) {
  const chord = parseChord(text);
  if (!chord) return text;
  // Numbers are counted from the major key; a minor key counts from its relative major.
  const tonic = key.minor ? key.index + 3 : key.index;
  const degree = (note) => DEGREES[(noteIndex(note) - tonic + 24) % 12];
  return chord.lead + degree(chord.root) + chord.quality + (chord.bass ? `/${degree(chord.bass)}` : '') + chord.tail;
}

export const KEY_CHOICES = SHARPS.map((_, index) => ({ index, name: noteName(index, FLAT_MAJOR.has(index)) }));

/** "F#m" -> { index, minor }, or null if it is not a key. */
export function parseKey(name) {
  const match = String(name || '').trim().match(/^([A-G](?:#|b|♯|♭)?)(m|min|minor)?$/i);
  if (!match) return null;
  return { index: noteIndex(match[1][0].toUpperCase() + match[1].slice(1)), minor: !!match[2] };
}

const MAJOR_SCALE = [[0, '', '1'], [2, 'm', '2m'], [4, 'm', '3m'], [5, '', '4'], [7, '', '5'], [9, 'm', '6m'], [11, 'dim', '7°']];
const MINOR_SCALE = [[0, 'm', '1m'], [2, 'dim', '2°'], [3, '', 'b3'], [5, 'm', '4m'], [7, 'm', '5m'], [8, '', 'b6'], [10, '', 'b7']];

/** The chords that belong to a key, with their scale-degree numbers: [{ name, number }]. */
export function chordsInKey(key) {
  if (!key) return [];
  const flats = prefersFlats(key);
  return (key.minor ? MINOR_SCALE : MAJOR_SCALE).map(([step, quality, number]) => ({ name: noteName(key.index + step, flats) + quality, number }));
}
