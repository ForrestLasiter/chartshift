// Attaches recognised text to pieces. The words come either from a digital
// PDF's own text or from OCR; either way they arrive as rows of tokens with
// bounding boxes in page points:
//   rows = [{ ff, bold, tokens: [{ text, x0, y0, x1, y1 }] }]
// Each matched piece gets `t` (its word), `tok` (an id shared by the word's
// pieces) and, for chords, `chord`.
import { isChord, isChordLine, isNeutral } from './chords.js';

// OCR often stumbles on lone chord letters ("Cc" for C, "Ern" for Em).
export function repairChord(text) {
  const trimmed = text.replace(/[^A-Za-z0-9#b/+()]+$/, '');
  const tries = [
    trimmed,
    trimmed.replace(/rn/g, 'm'),
    trimmed.replace(/^([A-Ga-g])\1/i, '$1'),
  ].map((t) => t && t[0].toUpperCase() + t.slice(1));
  return tries.find((t) => t && isChord(t)) || null;
}

/**
 * Which tokens of a row are chords. A row is everything at one height across
 * the whole page, so on a two-column chart a chord row in one column can share
 * its height with a lyric line in the other. Judging the row as a whole would
 * then miss the chords, so each chord-like token is also judged by its own
 * neighbours: it is a chord if, on each side, there is nothing nearby, or the
 * neighbour is itself a chord. A lyric word such as "A" or "Am" always has an
 * ordinary word one space away, so it is not mistaken for one.
 * With `repair` (OCR), a near miss such as "Cc" or "Ern" counts as its chord.
 * Returns a Map of token index -> chord name (tokens sorted left to right).
 */
export function chordTokens(tokens, { repair = false } = {}) {
  const names = tokens.map((t) => {
    if (isChord(t.text)) return t.text;
    return repair && t.text.length <= 6 && /^[A-G]/.test(t.text) ? repairChord(t.text) : null;
  });
  const wholeRow = isChordLine(tokens.map((t, i) => names[i] || t.text));
  const found = new Map();
  tokens.forEach((token, i) => {
    if (!names[i]) return;
    if (wholeRow || standsAlone(tokens, i, names)) found.set(i, names[i]);
  });
  return found;
}

// True when a token has no ordinary word close by on either side: nothing
// there, or a chord, or a bar line. `names[j]` is truthy for chord tokens.
function standsAlone(tokens, i, names) {
  const token = tokens[i];
  // Roughly two character widths: wider than the space between lyric words.
  const reach = ((token.y1 - token.y0) / 1.25) * 1.2;
  const clear = (j) => {
    const other = tokens[j];
    if (!other) return true;
    const gap = j < i ? token.x0 - other.x1 : other.x0 - token.x1;
    return gap > reach || !!names[j] || isNeutral(other.text);
  };
  return clear(i - 1) && clear(i + 1);
}

/**
 * `uncertain` is for OCR: on a chord row, words that did not read as a chord
 * (or were not read at all) are still marked, as '?' or their best guess, so
 * the review step can show them for correction instead of silently losing them.
 * `onlyUnread` leaves words that already have text alone (used to fill in what
 * a PDF's own text did not cover).
 */
export function applyTokens(pieces, rows, ids, { uncertain = false, onlyUnread = false } = {}) {
  // Work in whole detected words so a word is never split between two tokens.
  const words = new Map();
  for (const p of pieces) {
    if (p.kind !== 'clip' || p.frame) continue;
    let w = words.get(p.word);
    if (!w) words.set(p.word, (w = { pieces: [], x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }));
    w.pieces.push(p);
    w.x0 = Math.min(w.x0, p.x);
    w.y0 = Math.min(w.y0, p.y);
    w.x1 = Math.max(w.x1, p.x + p.w);
    w.y1 = Math.max(w.y1, p.y + p.h);
  }
  const wordList = [...words.values()]
    .filter((w) => !onlyUnread || !w.pieces.some((p) => p.t))
    .map((w) => ({ ...w, cx: (w.x0 + w.x1) / 2, cy: (w.y0 + w.y1) / 2, used: false }));

  let tokens = 0, chords = 0;
  for (const row of rows) {
    const sorted = row.tokens.slice().sort((a, b) => a.x0 - b.x0);
    const chordNames = chordTokens(sorted, { repair: uncertain });
    const chordRow = isChordLine(sorted.map((t, i) => chordNames.get(i) || t.text));
    for (const [index, token] of sorted.entries()) {
      const slack = Math.min(3, (token.y1 - token.y0) * 0.25);
      const hits = wordList.filter((w) => !w.used
        && w.cx >= token.x0 - slack && w.cx <= token.x1 + slack
        && w.cy >= token.y0 && w.cy <= token.y1);
      if (!hits.length) continue;
      const tok = ids.group++;
      let text = chordNames.get(index) || token.text;
      let chord = chordNames.has(index);
      // On a row that is clearly chords, a short unreadable word standing on
      // its own is kept for the review step rather than dropped. Headings and
      // lyric words that merely share the row's height are left alone.
      if (chordRow && !chord && uncertain && !isNeutral(text) && text.length <= 4
        && standsAlone(sorted, index, sorted.map((t, j) => chordNames.get(j) || (j === index ? 'x' : null)))) chord = true;
      tokens++;
      if (chord) chords++;
      for (const w of hits) {
        w.used = true;
        for (const p of w.pieces) {
          p.t = text;
          p.tok = tok;
          if (chord) {
            p.chord = text;
            if (row.ff) p.ff = row.ff;
            if (row.bold) p.bold = true;
          }
        }
      }
    }
    if (chordRow && uncertain) {
      // Letters on the chord row that OCR skipped entirely.
      const y0 = Math.min(...row.tokens.map((t) => t.y0)), y1 = Math.max(...row.tokens.map((t) => t.y1));
      for (const w of wordList) {
        if (w.used || w.cy < y0 || w.cy > y1 || w.y1 - w.y0 < (y1 - y0) * 0.4) continue;
        // Only short marks can be chords; a longer unread word is a lyric.
        if (w.x1 - w.x0 > (y1 - y0) * 3 || w.pieces.length > 5) continue;
        w.used = true;
        const tok = ids.group++;
        chords++;
        for (const p of w.pieces) Object.assign(p, { t: '?', tok, chord: '?' });
      }
    }
  }
  return { tokens, chords };
}

/**
 * False for text a PDF could not really supply. Some PDFs draw part of their
 * text (often the bold chords) in a font with no character table, and what
 * comes out is control codes, private-use symbols or the "unknown" mark. Such
 * words are better treated as unread, so OCR can read them from the picture.
 */
export const isReadable = (text) => !/[\u0000-\u001f\u007f-\u009f\ue000-\uf8ff\ufffd\ufff0-\uffff]/.test(text);

/** How many words on a page have no text behind them (ignoring specks and staff contents). */
export function unreadWords(pieces) {
  const words = new Map();
  for (const p of pieces) {
    if (p.kind !== 'clip' || p.frame || p.contained || p.h < 4) continue;
    words.set(p.word, (words.get(p.word) || false) || !!p.t);
  }
  return [...words.values()].filter((read) => !read).length;
}

let measureCtx = null;

/** Turns pdf.js text items into rows of tokens (page points, y down). */
export function rowsFromPdfText(textContent, viewportTransform, transform, fontNames) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  const lines = [];
  for (const item of textContent.items) {
    if (!item.str || !item.str.trim()) continue;
    const m = transform(viewportTransform, item.transform);
    // Skip rotated text; it cannot be a chord or lyric row.
    if (Math.abs(m[1]) > 0.01 || Math.abs(m[2]) > 0.01) continue;
    const size = Math.hypot(m[2], m[3]);
    const family = textContent.styles[item.fontName]?.fontFamily || 'sans-serif';
    const ff = /mono/i.test(family) ? 'mono' : /sans/i.test(family) ? 'sans' : 'serif';
    measureCtx.font = `${size}px ${family}`;
    const full = measureCtx.measureText(item.str).width || 1;
    const scale = item.width / full;
    const tokens = [];
    for (const match of item.str.matchAll(/\S+/g)) {
      if (!isReadable(match[0])) continue;
      const start = measureCtx.measureText(item.str.slice(0, match.index)).width * scale;
      const end = measureCtx.measureText(item.str.slice(0, match.index + match[0].length)).width * scale;
      tokens.push({ text: match[0], x0: m[4] + start, x1: m[4] + end, y0: m[5] - size * 0.95, y1: m[5] + size * 0.3 });
    }
    const bold = /bold|black|heavy/i.test(fontNames?.get(item.fontName) || '');
    lines.push({ baseline: m[5], size, ff, bold, tokens });
  }
  // Items on the same baseline form one row (a chord line is often many items).
  lines.sort((a, b) => a.baseline - b.baseline);
  const rows = [];
  for (const line of lines) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.baseline - line.baseline) < line.size * 0.3) last.tokens.push(...line.tokens);
    else rows.push({ baseline: line.baseline, ff: line.ff, bold: line.bold, tokens: [...line.tokens] });
  }
  for (const row of rows) row.tokens.sort((a, b) => a.x0 - b.x0);
  return rows;
}
