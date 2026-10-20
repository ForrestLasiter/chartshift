// From notes read off a page to what a guitarist wants: bars, beats, the
// melody, and a chord for each bar (or half bar). Pure, no DOM.
import { noteName, prefersFlats } from './chords.js';

const median = (values) => { const s = values.slice().sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };

// Chord shapes worth suggesting, with a small cost for the less plain ones.
const SHAPES = [
  { quality: '', tones: [0, 4, 7], cost: 0 },
  { quality: 'm', tones: [0, 3, 7], cost: 0 },
  { quality: '7', tones: [0, 4, 7, 10], cost: 0.1 },
  { quality: 'm7', tones: [0, 3, 7, 10], cost: 0.14 },
  { quality: 'maj7', tones: [0, 4, 7, 11], cost: 0.5 },
  { quality: 'sus4', tones: [0, 5, 7], cost: 0.16 },
  { quality: 'dim', tones: [0, 3, 6], cost: 0.22 },
];
// Chords that belong to a major key, by semitones above the key note, with
// how strongly to expect each one. With only a tune to go on, the three main
// chords (I, IV and V) are much the likeliest.
const MAJOR_DIATONIC = new Map([[0, ['']], [2, ['m', 'm7']], [4, ['m']], [5, ['']], [7, ['', '7']], [9, ['m', 'm7']]]);
const MELODY_PRIOR = { 0: 0.4, 5: 0.35, 7: 0.35, 9: 0.15, 2: 0.08, 4: 0.04 };

/** The key a key signature (number of sharps, or negative for flats) gives a major-key piece. */
export const keyOfSignature = (fifths) => ({ index: (((fifths * 7) % 12) + 12) % 12, minor: false });

/**
 * The best chord for a set of sounding notes.
 * notes: [{ midi, duration }], bass: midi of the lowest note at the strongest point (or null).
 * Returns { root, quality, score } or null when there is nothing to go on.
 */
export function bestChord(notes, { key, bass = null, previous = null, melodyOnly = false } = {}) {
  const weight = new Float64Array(12);
  let total = 0;
  for (const n of notes) { weight[((n.midi % 12) + 12) % 12] += n.duration; total += n.duration; }
  if (!total) return null;
  const bassPc = bass == null ? null : ((bass % 12) + 12) % 12;
  // Notes outside the key's scale: a chord from outside the key is only
  // offered for a bare tune when the tune itself has one of them.
  const scale = key ? new Set([0, 2, 4, 5, 7, 9, 11].map((t) => (key.index + t) % 12)) : null;
  const chromatic = scale ? [...weight.keys()].filter((pc) => weight[pc] > 0 && !scale.has(pc)) : [];
  let best = null;
  for (let root = 0; root < 12; root++) {
    for (const shape of SHAPES) {
      const tones = new Set(shape.tones.map((t) => (root + t) % 12));
      let inside = 0;
      for (const pc of tones) inside += weight[pc];
      const outside = total - inside;
      // A seventh (or other added note) has to be heard to be suggested.
      if (shape.tones.length > 3 && weight[(root + shape.tones[3]) % 12] < 0.2 * total) continue;
      if (shape.quality === 'sus4' && weight[(root + 5) % 12] < 0.2 * total) continue;
      let score = inside - 0.75 * outside - shape.cost * total;
      if (!weight[root]) score -= 0.25 * total;
      if (bassPc != null) score += bassPc === root ? 0.3 * total : tones.has(bassPc) ? 0.05 * total : -0.1 * total;
      if (key) {
        const fits = MAJOR_DIATONIC.get((root - key.index + 12) % 12);
        const degree = (root - key.index + 12) % 12;
        if (fits && fits.includes(shape.quality)) score += (melodyOnly ? MELODY_PRIOR[degree] : 0.1) * total;
        else if (melodyOnly) {
          if (!chromatic.some((pc) => tones.has(pc))) continue;
          score -= 0.1 * total;
        } else if ([...tones].some((pc) => !scale.has(pc)) && ![...tones].some((pc) => !scale.has(pc) && weight[pc] > 0)) {
          // A chord with notes from outside the key is only named when the
          // music has one of those notes (an accidental, as in E7 in G).
          continue;
        }
      }
      if (previous && previous.root === root && previous.quality === shape.quality) score += 0.06 * total;
      if (!best || score > best.score) best = { root, quality: shape.quality, score };
    }
  }
  return best;
}

// Notes close together across the page start at the same moment.
function onsetsOf(notes, space) {
  const sorted = notes.slice().sort((a, b) => a.x - b.x);
  const onsets = [];
  for (const n of sorted) {
    const last = onsets[onsets.length - 1];
    if (last && n.x - last.x < 0.8 * space) { last.notes.push(n); last.x = (last.x * (last.notes.length - 1) + n.x) / last.notes.length; } else onsets.push({ x: n.x, notes: [n] });
  }
  let time = 0;
  for (const o of onsets) {
    o.time = time;
    time += Math.min(...o.notes.map((n) => n.duration));
  }
  return { onsets, length: time };
}

// The tune: on the top staff, the highest note at each moment. Where that
// staff holds two parts (stems up and stems down), only the upper part counts.
function melodyOf(onsets, topStaff) {
  const mine = onsets.map((o) => o.notes.filter((n) => n.staff === topStaff));
  // Two parts on one staff have stems of their own, up and down. (In some
  // books both parts hang on one stem; then it is one part in chords.)
  const twoParts = mine.some((list) => list.some((n) => n.stem === 'up' && list.some((m) => m.stem === 'down' && m.stemX !== n.stemX)));
  const melody = [];
  mine.forEach((list, i) => {
    const voice = twoParts ? list.filter((n) => n.stem !== 'down') : list;
    if (!voice.length) return;
    melody.push({ ...voice.reduce((a, b) => (a.midi > b.midi ? a : b)), time: onsets[i].time });
  });
  return melody;
}

const chordName = (chord, key) => noteName(chord.root, prefersFlats(key)) + chord.quality;

/**
 * Turns the reader's notes into bars with chords and a melody.
 * @returns {{ key, beats, measures: [{ system, x0, x1, length, onsets, melody, chords: [{ name, time, x }] }] }}
 */
export function analyse(music) {
  const measures = [];
  for (const [systemIndex, sys] of music.systems.entries()) {
    const space = median(sys.staffs.map((i) => music.staffs[i].space));
    const notes = music.notes.filter((n) => sys.staffs.includes(n.staff));
    const edges = [sys.x0, ...sys.bars.filter((b) => b > sys.x0 + space && b < sys.x1 - space), sys.x1 + 1];
    for (let k = 0; k + 1 < edges.length; k++) {
      const inside = notes.filter((n) => n.x >= edges[k] && n.x < edges[k + 1]);
      if (!inside.length) continue;
      const { onsets, length } = onsetsOf(inside, space);
      measures.push({ system: systemIndex, x0: edges[k], x1: edges[k + 1], length, onsets, melody: melodyOf(onsets, sys.staffs[0]), staffs: sys.staffs });
    }
  }
  const firstStaff = music.staffs[music.systems[0]?.staffs[0]];
  let key = keyOfSignature(firstStaff ? firstStaff.fifths : 0);
  const melodyOnly = music.systems.every((s) => s.staffs.length === 1) && music.notes.every((n, i, all) => !all.some((m) => m !== n && m.staff === n.staff && Math.abs(m.x - n.x) < 0.5 * firstStaff.space));

  const chordsFor = (onsets, previous) => {
    const sounding = onsets.flatMap((o) => o.notes);
    const first = onsets[0];
    const bass = first ? first.notes.reduce((a, b) => (a.midi < b.midi ? a : b)).midi : null;
    return bestChord(sounding, { key, bass: melodyOnly ? null : bass, previous, melodyOnly });
  };
  const place = () => {
    let previous = null;
    for (const m of measures) {
      const whole = chordsFor(m.onsets, previous);
      m.chords = [];
      if (!whole) continue;
      // A second chord half way through the bar, when the harmony clearly moves.
      const half = m.length / 2;
      const splitAt = m.onsets.slice(1).reduce((best, o) => (!best || Math.abs(o.time - half) < Math.abs(best.time - half) ? o : best), null);
      let used = [{ chord: whole, onset: m.onsets[0] }];
      if (splitAt && splitAt.time > 0 && Math.abs(splitAt.time - half) <= m.length / 4) {
        const a = chordsFor(m.onsets.filter((o) => o.time < splitAt.time), previous);
        const b = chordsFor(m.onsets.filter((o) => o.time >= splitAt.time), a);
        const total = m.onsets.reduce((sum, o) => sum + o.notes.reduce((s, n) => s + n.duration, 0), 0);
        if (a && b && (a.root !== b.root || a.quality !== b.quality) && a.score + b.score > whole.score + (melodyOnly ? 0.3 : 0.05) * total) {
          used = [{ chord: a, onset: m.onsets[0] }, { chord: b, onset: splitAt }];
        }
      }
      m.chords = used.map(({ chord, onset }) => ({ root: chord.root, quality: chord.quality, time: onset.time, x: onset.x }));
      previous = used[used.length - 1].chord;
    }
  };
  place();
  // A piece that ends on the relative minor's chord is taken to be in that minor key.
  const lastChord = measures.length && measures[measures.length - 1].chords.slice(-1)[0];
  if (lastChord && lastChord.root === (key.index + 9) % 12 && lastChord.quality.startsWith('m') && !lastChord.quality.startsWith('maj')) {
    key = { index: (key.index + 9) % 12, minor: true };
  }
  for (const m of measures) for (const c of m.chords) c.name = chordName(c, key);
  const lengths = measures.map((m) => m.length).filter((l) => l > 0);
  return { key, beats: lengths.length ? median(lengths) : 0, measures, melodyOnly };
}
