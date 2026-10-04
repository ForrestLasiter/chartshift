// Chord fingering diagrams for guitar and ukulele.
//
// A shape lists one fret per string, lowest-pitched string first:
// 0 = open, -1 = not played. Common open chords are listed by hand; everything
// else is built from movable (barre) shapes. test/songwriting.test.mjs checks
// every shape against the notes the chord should contain.
import { noteIndex, parseChord } from './chords.js';

export const INSTRUMENTS = {
  guitar: { label: 'Guitar', tuning: [4, 9, 2, 7, 11, 4] },   // E A D G B E
  ukulele: { label: 'Ukulele', tuning: [7, 0, 4, 9] },        // G C E A
};

// Notes of each chord type, as semitones above the root.
export const CHORD_TONES = {
  '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11],
  sus4: [0, 5, 7], sus2: [0, 2, 7], add9: [0, 2, 4, 7],
};

const OPEN = {
  guitar: {
    C: [-1, 3, 2, 0, 1, 0], D: [-1, -1, 0, 2, 3, 2], E: [0, 2, 2, 1, 0, 0], G: [3, 2, 0, 0, 0, 3], A: [-1, 0, 2, 2, 2, 0],
    Am: [-1, 0, 2, 2, 1, 0], Dm: [-1, -1, 0, 2, 3, 1], Em: [0, 2, 2, 0, 0, 0],
    C7: [-1, 3, 2, 3, 1, 0], D7: [-1, -1, 0, 2, 1, 2], E7: [0, 2, 0, 1, 0, 0], G7: [3, 2, 0, 0, 0, 1], A7: [-1, 0, 2, 0, 2, 0], B7: [-1, 2, 1, 2, 0, 2],
    Am7: [-1, 0, 2, 0, 1, 0], Dm7: [-1, -1, 0, 2, 1, 1], Em7: [0, 2, 0, 0, 0, 0],
    Cmaj7: [-1, 3, 2, 0, 0, 0], Dmaj7: [-1, -1, 0, 2, 2, 2], Fmaj7: [-1, -1, 3, 2, 1, 0], Amaj7: [-1, 0, 2, 1, 2, 0],
    Dsus4: [-1, -1, 0, 2, 3, 3], Asus4: [-1, 0, 2, 2, 3, 0], Esus4: [0, 2, 2, 2, 0, 0],
    Dsus2: [-1, -1, 0, 2, 3, 0], Asus2: [-1, 0, 2, 2, 0, 0],
    Cadd9: [-1, 3, 2, 0, 3, 0], F: [1, 3, 3, 2, 1, 1],
  },
  ukulele: {
    C: [0, 0, 0, 3], F: [2, 0, 1, 0], G: [0, 2, 3, 2], A: [2, 1, 0, 0], D: [2, 2, 2, 0],
    Am: [2, 0, 0, 0], Dm: [2, 2, 1, 0], Em: [0, 4, 3, 2], Gm: [0, 2, 3, 1],
    C7: [0, 0, 0, 1], G7: [0, 2, 1, 2], A7: [0, 1, 0, 0], D7: [2, 2, 2, 3], E7: [1, 2, 0, 2],
    Am7: [0, 0, 0, 0], Dm7: [2, 2, 1, 3], Em7: [0, 2, 0, 2],
    Cmaj7: [0, 0, 0, 2], Fmaj7: [2, 4, 1, 3],
  },
};

// Movable shapes: frets relative to the barre, and the open-string root the shape is built on.
const MOVABLE = {
  guitar: [
    { root: 4, shapes: { '': [0, 2, 2, 1, 0, 0], m: [0, 2, 2, 0, 0, 0], 7: [0, 2, 0, 1, 0, 0], m7: [0, 2, 0, 0, 0, 0], sus4: [0, 2, 2, 2, 0, 0] } },
    { root: 9, shapes: { '': [-1, 0, 2, 2, 2, 0], m: [-1, 0, 2, 2, 1, 0], 7: [-1, 0, 2, 0, 2, 0], m7: [-1, 0, 2, 0, 1, 0], maj7: [-1, 0, 2, 1, 2, 0], sus4: [-1, 0, 2, 2, 3, 0], sus2: [-1, 0, 2, 2, 0, 0] } },
  ],
  ukulele: [
    { root: 9, shapes: { '': [2, 1, 0, 0], m: [2, 0, 0, 0], 7: [0, 1, 0, 0], m7: [0, 0, 0, 0], maj7: [1, 1, 0, 0], sus4: [2, 2, 0, 0] } },
    { root: 0, shapes: { '': [0, 0, 0, 3], 7: [0, 0, 0, 1], maj7: [0, 0, 0, 2] } },
  ],
};

// Brings the many ways of writing a chord down to the types there are shapes for.
function chordType(quality) {
  const q = quality.replace(/[()]/g, '');
  if (/^(maj7|M7|Δ)/.test(q)) return 'maj7';
  if (/^(m|min|-)(?!aj)/.test(q)) return /7|9|11|13/.test(q) ? 'm7' : 'm';
  if (/^sus2/.test(q)) return 'sus2';
  if (/^sus/.test(q)) return 'sus4';
  if (/^add9/.test(q)) return 'add9';
  if (/^(7|9|11|13)/.test(q)) return '7';
  if (/dim|aug|°|ø|\+/.test(q)) return null;
  return '';
}

// Spellings that are shown exactly; anything else is drawn as a plainer chord of its family.
const EXACT = { '': '', m: 'm', min: 'm', '-': 'm', 7: '7', m7: 'm7', min7: 'm7', maj7: 'maj7', M7: 'maj7', sus4: 'sus4', sus: 'sus4', sus2: 'sus2', add9: 'add9' };

/**
 * The fingering for a chord, or null when there is no shape for it.
 * Returns { frets, baseFret, simplified } - `simplified` when a plainer chord
 * of the same family is shown (C7 for C9, C for C6, the chord without its bass note).
 */
export function shapeFor(name, instrument = 'guitar') {
  const chord = parseChord(name);
  if (!chord || !INSTRUMENTS[instrument]) return null;
  const quality = chord.quality.replace(/[()]/g, '');
  let type = chordType(quality);
  if (type == null) return null;
  const root = noteIndex(chord.root);
  let simplified = !!chord.bass || EXACT[quality] !== type;
  const openShape = (wanted) => {
    const found = Object.entries(OPEN[instrument]).find(([key]) => {
      const k = parseChord(key);
      return noteIndex(k.root) === root && chordType(k.quality) === wanted;
    });
    return found ? found[1] : null;
  };
  let frets = openShape(type);
  if (!frets && type === 'add9') { type = ''; simplified = true; frets = openShape(type); }
  if (frets) return { frets, baseFret: 1, simplified };

  let best = null;
  for (const family of MOVABLE[instrument]) {
    const shape = family.shapes[type];
    if (!shape) continue;
    const barre = (root - family.root + 12) % 12;
    if (!best || barre < best.barre) best = { barre, shape };
  }
  if (!best) return null;
  frets = best.shape.map((f) => (f < 0 ? -1 : f + best.barre));
  const fretted = frets.filter((f) => f > 0);
  return { frets, baseFret: Math.max(...frets) <= 4 ? 1 : Math.min(...fretted), simplified };
}

/** The pitch classes a shape sounds, for checking it. */
export function shapeNotes(frets, instrument) {
  const { tuning } = INSTRUMENTS[instrument];
  return frets.map((f, i) => (f < 0 ? null : (tuning[i] + f) % 12)).filter((n) => n != null);
}

export const DIAGRAM_SIZE = { w: 44, h: 60 };

/** Draws a diagram piece { x, y, w, h, chord, instrument } on a page canvas (units: points). */
export function drawDiagram(ctx, p) {
  const shape = shapeFor(p.chord, p.instrument);
  const strings = INSTRUMENTS[p.instrument]?.tuning.length || 6;
  const s = p.w / DIAGRAM_SIZE.w;
  const left = p.x + 7 * s, right = p.x + p.w - 7 * s;
  const top = p.y + 22 * s, bottom = p.y + p.h - 3 * s;
  const frets = 4;
  const gapX = (right - left) / (strings - 1), gapY = (bottom - top) / frets;

  ctx.save();
  ctx.fillStyle = '#000000';
  ctx.strokeStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `bold ${9.5 * s}px Arial, Helvetica, sans-serif`;
  ctx.fillText(p.chord, p.x + p.w / 2, p.y + 9 * s);

  ctx.lineWidth = 0.5 * s;
  ctx.beginPath();
  for (let i = 0; i < strings; i++) { ctx.moveTo(left + i * gapX, top); ctx.lineTo(left + i * gapX, bottom); }
  for (let f = 0; f <= frets; f++) { ctx.moveTo(left, top + f * gapY); ctx.lineTo(right, top + f * gapY); }
  ctx.stroke();

  if (!shape) {
    ctx.font = `${7 * s}px Arial, Helvetica, sans-serif`;
    ctx.fillText('no shape', p.x + p.w / 2, top + gapY * 2 + 2 * s);
    ctx.restore();
    return;
  }
  if (shape.baseFret === 1) {
    ctx.fillRect(left - 0.25 * s, top - 1.6 * s, right - left + 0.5 * s, 1.8 * s); // the nut
  } else {
    ctx.font = `${6.5 * s}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(`${shape.baseFret}fr`, right + 1.5 * s, top + gapY * 0.5 + 2.2 * s);
    ctx.textAlign = 'center';
  }
  ctx.font = `${6.5 * s}px Arial, Helvetica, sans-serif`;
  shape.frets.forEach((fret, i) => {
    const x = left + i * gapX;
    if (fret < 0) ctx.fillText('×', x, top - 3 * s);
    else if (fret === 0) { ctx.beginPath(); ctx.arc(x, top - 5 * s, 1.7 * s, 0, Math.PI * 2); ctx.lineWidth = 0.6 * s; ctx.stroke(); }
    else {
      const row = fret - shape.baseFret;
      if (row < 0 || row >= frets) return;
      ctx.beginPath();
      ctx.arc(x, top + (row + 0.5) * gapY, Math.min(gapX, gapY) * 0.36, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  ctx.restore();
}
