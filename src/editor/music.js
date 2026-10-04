// Chords and whole-song layout: transposing, Nashville numbers, capo,
// marking chords by hand, fit-to-one-page and large print.
import { boundsOf } from '../lib/render.js';
import { FONTS, baselineOffset, measureText, sizeForCapHeight } from '../lib/text.js';
import { isChord, keyName, keyOf, noteName, parseChord, prefersFlats, toNashville, transposeChord } from '../lib/chords.js';
import { applyTokens } from '../lib/textlayer.js';
import { enlarge, fitToOnePage } from '../lib/layout.js';

const FAMILY = {
  mono: FONTS.find((f) => f.label.startsWith('Courier')).css,
  serif: FONTS.find((f) => f.label.startsWith('Times')).css,
  sans: FONTS[0].css,
};

const hex = (n) => Math.round(n).toString(16).padStart(2, '0');

// The colour a sprite's solid ink shows as on white paper, so re-typed chords
// keep their colour.
function inkColor(atlas, p) {
  if (!atlas) return '#000000';
  const { data } = atlas.getContext('2d').getImageData(p.sx, p.sy, p.sw, p.sh);
  let peak = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > peak) peak = data[i];
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    if (data[i + 3] < peak * 0.9) continue;
    r += data[i] * a + 255 * (1 - a);
    g += data[i + 1] * a + 255 * (1 - a);
    b += data[i + 2] * a + 255 * (1 - a);
    n++;
  }
  return n ? `#${hex(r / n)}${hex(g / n)}${hex(b / n)}` : '#000000';
}

export function installMusic(ed) {
  const state = () => ed.getState();
  const remeasure = (piece) => measureText(piece);

  /** Every chord in the song in reading order: [{ pageIndex, key, ids, text, pieces }]. */
  ed.chordList = () => {
    const list = [];
    (state().pages || []).forEach((page, pageIndex) => {
      const tokens = new Map();
      for (const p of page.pieces) {
        if (p.kind === 'text') {
          if (p.chord) list.push({ pageIndex, key: `p${p.id}`, ids: [p.id], text: p.text, pieces: [p], x: p.x, y: p.y });
        } else if (p.chord) {
          let entry = tokens.get(p.tok);
          if (!entry) {
            entry = { pageIndex, key: `t${p.tok}`, ids: [], text: p.chord, pieces: [], x: p.x, y: p.y };
            tokens.set(p.tok, entry);
            list.push(entry);
          }
          entry.ids.push(p.id);
          entry.pieces.push(p);
          entry.x = Math.min(entry.x, p.x);
          entry.y = Math.min(entry.y, p.y);
        }
      }
    });
    return list.sort((a, b) => a.pageIndex - b.pageIndex || (Math.abs(a.y - b.y) > 5 ? a.y - b.y : a.x - b.x));
  };

  /** The song's key, guessed from its first chord. */
  ed.songKey = () => {
    for (const chord of ed.chordList()) {
      const key = keyOf(chord.text);
      if (key) return key;
    }
    return null;
  };

  // Replaces a chord's original letters with a text box in a matching font,
  // sitting on the same baseline at the same height.
  const retype = (entry, text) => {
    const pieces = entry.pieces.slice().sort((a, b) => a.x - b.x);
    const lead = parseChord(entry.text)?.lead.length || 0;
    const root = pieces[Math.min(lead, pieces.length - 1)];
    const style = { font: FAMILY[pieces[0].ff] || FAMILY.sans, bold: !!pieces[0].bold, italic: false };
    const size = Math.max(5, Math.round(sizeForCapHeight(style, Math.max(3, root.h - 0.35)) * 10) / 10);
    const b = boundsOf(pieces);
    const piece = {
      id: ed.ids.piece++, kind: 'text', chord: true, text, ...style, size,
      color: inkColor(ed.atlases[root.atlas], root),
      x: b.x, y: root.y + root.h - 0.15 - baselineOffset({ ...style, size }),
    };
    if (pieces[0].section != null) piece.section = pieces[0].section;
    return { ...piece, ...measureText(piece) };
  };

  // Rewrites every chord through `fn(text)`. Chords still made of original
  // letters are re-typed; chords that are already text boxes are just edited.
  const rewriteChords = (fn, status) => {
    const byPage = new Map();
    for (const entry of ed.chordList()) {
      const text = fn(entry.text);
      if (text === entry.text) continue;
      if (!byPage.has(entry.pageIndex)) byPage.set(entry.pageIndex, { drop: new Set(), edit: new Map(), add: [] });
      const plan = byPage.get(entry.pageIndex);
      if (entry.pieces[0].kind === 'text') plan.edit.set(entry.ids[0], text);
      else {
        entry.ids.forEach((id) => plan.drop.add(id));
        plan.add.push(retype(entry, text));
      }
    }
    if (!byPage.size) return ed.set({ status: 'No chords to change. Mark or read the chords first.' });
    let count = 0;
    const pages = state().pages.map((page, i) => {
      const plan = byPage.get(i);
      if (!plan) return page;
      count += plan.edit.size + plan.add.length;
      const pieces = page.pieces
        .filter((p) => !plan.drop.has(p.id))
        .map((p) => {
          if (!plan.edit.has(p.id)) return p;
          const next = { ...p, text: plan.edit.get(p.id) };
          return { ...next, ...measureText(next) };
        });
      return { ...page, pieces: [...pieces, ...plan.add] };
    });
    ed.commit(pages, { selection: new Set(), status: status(count) });
  };

  /** spelling: 'auto' picks sharps or flats to suit the new key. */
  ed.transpose = (semitones, spelling = 'auto') => {
    const key = ed.songKey();
    if (!key) return ed.set({ status: 'No chords found yet. Use “Read text” on a scan, or select a chord and use “Mark as chord”.' });
    const target = { index: (key.index + semitones + 120) % 12, minor: key.minor };
    const useFlats = spelling === 'auto' ? prefersFlats(target) : spelling === 'flats';
    const to = noteName(target.index, useFlats) + (key.minor ? 'm' : '');
    rewriteChords(
      (text) => transposeChord(text, semitones, useFlats),
      (count) => `Transposed ${count} chords from ${keyName(key)} to ${to}.`,
    );
  };

  ed.nashville = () => {
    const key = ed.songKey();
    if (!key) return ed.set({ status: 'No chords found yet.' });
    rewriteChords((text) => toNashville(text, key), (count) => `Changed ${count} chords to Nashville numbers in ${keyName(key)}.`);
  };

  // Capo: the chord shapes drop by `fret` semitones and a "Capo N" note is added.
  ed.capo = (fret) => {
    const key = ed.songKey();
    if (!key || !fret) return ed.set({ status: key ? 'Choose a capo fret first.' : 'No chords found yet.' });
    const before = state().pages;
    ed.transpose(-fret);
    const st = state();
    if (st.pages === before) return;
    const page = st.pages[0];
    const top = boundsOf(page.pieces.filter((p) => !p.frame));
    const note = { id: ed.ids.piece++, kind: 'text', text: `Capo ${fret}`, ...st.textStyle, bold: true, x: 0, y: Math.max(12, (top?.y ?? 40) - 20) };
    Object.assign(note, measureText(note));
    note.x = page.w - note.w - 40;
    const pages = st.pages.map((p, i) => (i === 0 ? { ...p, pieces: [...p.pieces, note] } : p));
    // Fold the note into the transpose step so one Undo reverses both.
    ed.set({ pages, status: `Capo ${fret}: chords now show the shapes to play (${keyName(ed.songKey())} shapes).` });
  };

  /** Marks the selected pieces as one chord named `text` (or clears with ''). */
  ed.markChord = (text) => {
    const st = state();
    const name = text.trim();
    if (!st.selection.size) return ed.set({ status: 'Select the chord on the page first.' });
    if (name && !isChord(name)) return ed.set({ status: `“${name}” is not a chord name. Try something like G, Em7 or D/F#.` });
    const pages = st.pages.map((page) => {
      const picked = ed.selectedOn(page);
      if (!picked.length) return page;
      const tok = ed.ids.group++;
      const pieces = page.pieces.map((p) => {
        if (!st.selection.has(p.id)) return p;
        if (p.kind === 'text') {
          if (!name) { const { chord, ...rest } = p; return rest; }
          const next = { ...p, chord: true, text: name };
          return { ...next, ...measureText(next) };
        }
        if (!name) { const { chord, ...rest } = p; return rest; }
        return { ...p, chord: name, t: name, tok };
      });
      return { ...page, pieces };
    });
    ed.commit(pages, { status: name ? `Marked as chord ${name}.` : 'No longer treated as a chord.' });
  };

  /** Applies a review: edits = Map(key -> new text, or '' for "not a chord"). */
  ed.reviewChords = (edits) => {
    if (!edits.size) return;
    const byId = new Map();
    for (const entry of ed.chordList()) {
      if (edits.has(entry.key)) entry.ids.forEach((id) => byId.set(id, edits.get(entry.key)));
    }
    const pages = state().pages.map((page) => {
      if (!page.pieces.some((p) => byId.has(p.id))) return page;
      const pieces = page.pieces.map((p) => {
        if (!byId.has(p.id)) return p;
        const text = byId.get(p.id);
        if (!text) { const { chord, ...rest } = p; return rest; }
        if (p.kind === 'text') { const next = { ...p, text }; return { ...next, ...measureText(next) }; }
        return { ...p, chord: text, t: text };
      });
      return { ...page, pieces };
    });
    ed.commit(pages, { status: `Updated ${edits.size} chord${edits.size === 1 ? '' : 's'}.` });
  };

  /** Attaches recognised words (from OCR) to every page. rowsByPage[i] = rows. */
  ed.applyRecognisedText = (rowsByPage) => {
    let tokens = 0, chords = 0;
    const pages = state().pages.map((page, i) => {
      if (!rowsByPage[i]?.length) return page;
      const pieces = page.pieces.map((p) => ({ ...p }));
      // Text the PDF already provided is kept; OCR only fills in the rest.
      const found = applyTokens(pieces, rowsByPage[i], ed.ids, { uncertain: true, onlyUnread: true });
      tokens += found.tokens;
      chords += found.chords;
      return { ...page, pieces };
    });
    ed.commit(pages, { status: `Read ${tokens} words and found ${chords} chords. Check them before transposing.` });
    return { tokens, chords };
  };

  /** An enlarged picture of a chord's pieces on white, for reading it again. */
  ed.chordPicture = (entry, height = 48, pad = 24) => {
    const b = boundsOf(entry.pieces);
    const scale = height / Math.max(b.h, 1);
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(b.w * scale) + pad * 2;
    canvas.height = height + pad * 2;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    for (const p of entry.pieces) {
      if (p.kind === 'clip') ctx.drawImage(ed.atlases[p.atlas], p.sx, p.sy, p.sw, p.sh, pad + (p.x - b.x) * scale, pad + (p.y - b.y) * scale, p.w * scale, p.h * scale);
    }
    return canvas;
  };

  /**
   * Settles chords that were marked but could not be read ("?").
   * results: Map(key -> { chord: 'C' } | { word: 'working' } | null).
   * A chord gets its name; a word turns out not to be a chord; null stays "?".
   */
  ed.settleUnknownChords = (results) => {
    const byId = new Map();
    for (const entry of ed.chordList()) {
      const result = results.get(entry.key);
      if (result) entry.ids.forEach((id) => byId.set(id, result));
    }
    if (!byId.size) return 0;
    const pages = state().pages.map((page) => {
      if (!page.pieces.some((p) => byId.has(p.id))) return page;
      return { ...page, pieces: page.pieces.map((p) => {
        const result = byId.get(p.id);
        if (!result) return p;
        if (result.chord) return { ...p, chord: result.chord, t: result.chord };
        const { chord, ...rest } = p;
        return { ...rest, t: result.word };
      }) };
    });
    // Part of the same "read text" step: no separate undo entry.
    ed.set({ pages });
    return results.size;
  };

  ed.fitOnePage = () => {
    const result = fitToOnePage(state().pages, remeasure);
    if (!result) return ed.set({ status: 'The song already fits on one page.' });
    ed.commit(result.pages, { selection: new Set(), activePage: 0, status: `Fitted onto one page at ${Math.round(result.scale * 100)}% size.` });
  };

  ed.largePrint = () => {
    const result = enlarge(state().pages, 1.25, remeasure, () => ed.ids.page++);
    if (!result) return ed.set({ status: 'No room to enlarge: the widest line already fills the page width.' });
    const extra = result.pages.length - state().pages.length;
    ed.commit(result.pages, { selection: new Set(), status: `Enlarged to ${Math.round(result.scale * 100)}%${extra ? `, adding ${extra} page${extra === 1 ? '' : 's'}` : ''}.` });
  };
}
