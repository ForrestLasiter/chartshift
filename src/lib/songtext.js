// A written song is plain text: lyrics with chords in square brackets where
// they are played ("[G]Amazing [C]grace"), and headings on lines of their own
// ("Verse 1", "[Chorus]"). These functions work on that text. Pure, no DOM.
import { isChord, parseChord, transposeChord } from './chords.js';
import { headingOf } from './chordpro.js';

export { headingOf };

export const EMPTY_META = { title: '', artist: '', key: '', tempo: '', time: '', capo: '' };

const DIRECTIVE = /^\s*\{([^:}]+)(?::\s*(.*?))?\s*\}\s*$/;
const META_NAMES = { title: 'title', t: 'title', subtitle: 'artist', st: 'artist', artist: 'artist', key: 'key', tempo: 'tempo', time: 'time', capo: 'capo' };

/** Separates a ChordPro file into its header facts and the words-and-chords body. */
export function splitChordPro(source) {
  const meta = { ...EMPTY_META };
  const body = [];
  for (const line of String(source).replace(/\r/g, '').split('\n')) {
    const directive = line.match(DIRECTIVE);
    const name = directive && META_NAMES[directive[1].trim().toLowerCase()];
    if (name) { if (!meta[name]) meta[name] = (directive[2] || '').trim(); continue; }
    if (directive) {
      const key = directive[1].trim().toLowerCase();
      // Headings and comments become plain lines; section brackets are dropped.
      if (/^(comment|c|ci|comment_italic)$/.test(key)) { body.push(directive[2] || ''); continue; }
      if (/^(start_of_|so)/.test(key)) {
        const kind = key.replace(/^start_of_/, '').replace(/^so/, '');
        body.push(directive[2] || { chorus: 'Chorus', c: 'Chorus', verse: 'Verse', v: 'Verse', bridge: 'Bridge', b: 'Bridge' }[kind] || 'Section');
        continue;
      }
      if (/^(end_of_|eo)/.test(key)) continue;
    }
    body.push(line);
  }
  while (body.length && !body[0].trim()) body.shift();
  while (body.length && !body[body.length - 1].trim()) body.pop();
  return { meta, text: body.join('\n') };
}

/** The reverse: a ChordPro file from header facts and body text. */
export function joinChordPro(meta, text) {
  const head = [];
  if (meta.title) head.push(`{title: ${meta.title}}`);
  if (meta.artist) head.push(`{artist: ${meta.artist}}`);
  if (meta.key) head.push(`{key: ${meta.key}}`);
  if (meta.tempo) head.push(`{tempo: ${meta.tempo}}`);
  if (meta.time) head.push(`{time: ${meta.time}}`);
  if (meta.capo) head.push(`{capo: ${meta.capo}}`);
  const body = text.split('\n').map((line) => {
    const heading = headingOf(line);
    return heading ? `{comment: ${heading}}` : line;
  });
  return `${head.join('\n')}\n\n${body.join('\n')}\n`;
}

/** Applies `fn` to every chord written in brackets. Things in brackets that are not chords are left alone. */
export function mapChords(text, fn) {
  return text.split('\n').map((line) => (headingOf(line) ? line
    : line.replace(/\[([^\]\n]+)\]/g, (whole, inner) => (isChord(inner) ? `[${fn(inner)}]` : whole)))).join('\n');
}

export const transposeText = (text, semitones, useFlats) => mapChords(text, (chord) => transposeChord(chord, semitones, useFlats));

/** The distinct chords of a song, in the order they first appear. */
export function chordsUsed(text) {
  const seen = new Set();
  for (const line of text.split('\n')) {
    if (headingOf(line)) continue;
    for (const match of line.matchAll(/\[([^\]\n]+)\]/g)) if (isChord(match[1])) seen.add(match[1]);
  }
  return [...seen];
}

// --- structure ---------------------------------------------------------------

/**
 * The song as an intro (anything before the first heading) and its sections.
 * Each section is { label, lines } where lines[0] is the heading line itself.
 */
export function parseStructure(text) {
  const intro = [];
  const sections = [];
  for (const line of text.split('\n')) {
    const label = headingOf(line);
    if (label) sections.push({ label, lines: [line] });
    else if (sections.length) sections[sections.length - 1].lines.push(line);
    else intro.push(line);
  }
  return { intro, sections };
}

const trimEnd = (lines) => { const out = lines.slice(); while (out.length && !out[out.length - 1].trim()) out.pop(); return out; };

function build({ intro, sections }) {
  const parts = [];
  const head = trimEnd(intro);
  if (head.length) parts.push(head.join('\n'));
  for (const s of sections) parts.push(trimEnd(s.lines).join('\n'));
  return parts.join('\n\n');
}

export function moveSection(text, index, direction) {
  const song = parseStructure(text);
  const target = index + direction;
  if (target < 0 || target >= song.sections.length) return text;
  [song.sections[index], song.sections[target]] = [song.sections[target], song.sections[index]];
  return build(song);
}

export function duplicateSection(text, index) {
  const song = parseStructure(text);
  const section = song.sections[index];
  if (!section) return text;
  song.sections.splice(index + 1, 0, { label: section.label, lines: section.lines.slice() });
  return build(song);
}

export function deleteSection(text, index) {
  const song = parseStructure(text);
  if (!song.sections[index]) return text;
  song.sections.splice(index, 1);
  return build(song);
}

/** A heading for a new section of this kind, numbered after those already there ("Verse 3"). */
export function nextHeading(text, kind) {
  if (!/^verse$/i.test(kind)) return kind;
  const numbers = parseStructure(text).sections.map((s) => s.label.match(/^verse\s*(\d+)/i)).filter(Boolean).map((m) => Number(m[1]));
  return `Verse ${numbers.length ? Math.max(...numbers) + 1 : 1}`;
}

// --- syllables ---------------------------------------------------------------

// Words the general rule gets wrong, that turn up a lot in songs.
const SYLLABLE_FIXES = {
  every: 2, heaven: 2, heavens: 2, glorious: 3, beautiful: 3, fire: 1, desire: 2, higher: 2, prayer: 1, prayers: 1,
  hallelujah: 4, alleluia: 4, jesus: 2, saviour: 2, savior: 2, holy: 2, power: 2, flower: 2, our: 1, hour: 1,
  being: 2, seeing: 2, people: 2, little: 2, able: 2, wretched: 2, blessed: 2, loved: 1, saved: 1, lived: 1,
  create: 2, created: 3, quiet: 2, lion: 2, riot: 2, poem: 2, poet: 2, idea: 3, real: 1, really: 2,
};

/** Roughly how many syllables a word has. A guide for matching lines, not a dictionary. */
export function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (SYLLABLE_FIXES[w]) return SYLLABLE_FIXES[w];
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|[^aeiouytd]ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Syllables in a line of the song, ignoring chords. Null for headings, blank and chord-only lines. */
export function lineSyllables(line) {
  if (!line.trim() || headingOf(line) || DIRECTIVE.test(line)) return null;
  const words = line.replace(/\[[^\]\n]*\]/g, ' ').split(/[\s\-–—]+/).filter((w) => /[a-z]/i.test(w));
  if (!words.length) return null;
  return words.reduce((sum, word) => sum + syllables(word), 0);
}

// Used by the chord-diagram row: the chord without its bass note or brackets.
export const plainChord = (name) => { const c = parseChord(name); return c ? c.root + c.quality : name; };
