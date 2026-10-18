// Sheet music on a page: chord names above each bar and note names under the
// tune, worked out by the music reader (lib/omr.js, lib/sheet.js). They are
// ordinary text boxes, so they can be moved, edited or deleted, and the
// chords are marked as chords so transposing changes them too.
import { measureText } from '../lib/text.js';
import { noteName, prefersFlats } from '../lib/chords.js';

const SANS = 'Arial, Helvetica, sans-serif';
const CHORD_COLOR = '#1e3a8a';
const NOTE_COLOR = '#7c2d12';

/**
 * readings: [{ pageIndex, scale, music, result }] where `scale` is pixels of
 * the reader's picture per page point.
 * Returns how many chords and note names were added.
 */
export function sheetLabels(readings, ids, { chords = true, notes = true } = {}) {
  const added = new Map();
  let chordCount = 0, noteCount = 0;
  for (const { pageIndex, scale, music, result } of readings) {
    const pieces = [];
    const flats = prefersFlats(result.key);
    const text = (value, x, y, size, color, extra) => {
      const piece = { id: ids.piece++, kind: 'text', text: value, x, y, font: SANS, size, bold: !!extra?.chord, italic: false, color, ...extra };
      return Object.assign(piece, measureText(piece));
    };
    for (const m of result.measures) {
      const system = music.systems[m.system];
      const top = music.staffs[system.staffs[0]];
      const space = top.space / scale;
      if (chords) {
        const size = Math.max(8, Math.min(16, space * 1.7));
        for (const c of m.chords) {
          // Above the top staff, clear of most stems and notes on ledger lines.
          const above = Math.min(top.lines[0] / scale, ...m.melody.map((n) => n.y / scale)) - 1.2 * space;
          const piece = text(c.name, c.x / scale - space * 0.4, above - size * 1.2, size, CHORD_COLOR, { chord: true });
          pieces.push(piece);
          chordCount++;
        }
      }
      if (notes) {
        // The tune's note names in a row under its staff.
        const size = Math.max(6, Math.min(12, space * 1.15));
        const below = top.lines[4] / scale + 1.1 * space;
        for (const n of m.melody) {
          const piece = text(noteName(n.midi, flats), n.x / scale, below, size, NOTE_COLOR);
          piece.x -= piece.w / 2;
          pieces.push(piece);
          noteCount++;
        }
      }
    }
    if (pieces.length) added.set(pageIndex, pieces);
  }
  return { added, chordCount, noteCount };
}

export function installSheetMusic(ed) {
  /** Puts chord names and/or note names read from sheet music onto the pages. */
  ed.addSheetLabels = (readings, options) => {
    const { added, chordCount, noteCount } = sheetLabels(readings, ed.ids, options);
    if (!added.size) return ed.set({ status: 'Nothing to add: no notes were found.' });
    const pages = ed.getState().pages.map((page, i) => (added.has(i) ? { ...page, pieces: [...page.pieces, ...added.get(i)] } : page));
    const parts = [chordCount && `${chordCount} chord${chordCount === 1 ? '' : 's'}`, noteCount && `${noteCount} note name${noteCount === 1 ? '' : 's'}`].filter(Boolean);
    ed.commit(pages, {
      selection: new Set([...added.values()].flat().map((p) => p.id)),
      status: `Added ${parts.join(' and ')}. They are text boxes: move or change any that are wrong.`,
    });
  };
}
