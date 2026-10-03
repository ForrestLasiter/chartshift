// Attaches recognised text to pieces. The words come either from a digital
// PDF's own text or from OCR; either way they arrive as rows of tokens with
// bounding boxes in page points:
//   rows = [{ ff, bold, tokens: [{ text, x0, y0, x1, y1 }] }]
// Each matched piece gets `t` (its word), `tok` (an id shared by the word's
// pieces) and, for chords, `chord`.
import { isChord, isChordLine } from './chords.js';

// OCR often stumbles on lone chord letters ("Cc" for C, "Ern" for Em).
function repairChord(text) {
  const trimmed = text.replace(/[^A-Za-z0-9#b/+()]+$/, '');
  const tries = [
    trimmed,
    trimmed.replace(/rn/g, 'm'),
    trimmed.replace(/^([A-Ga-g])\1/i, '$1'),
  ].map((t) => t && t[0].toUpperCase() + t.slice(1));
  return tries.find((t) => t && isChord(t)) || null;
}

/**
 * `uncertain` is for OCR: on a chord row, words that did not read as a chord
 * (or were not read at all) are still marked, as '?' or their best guess, so
 * the review step can show them for correction instead of silently losing them.
 */
export function applyTokens(pieces, rows, ids, { uncertain = false } = {}) {
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
  const wordList = [...words.values()].map((w) => ({ ...w, cx: (w.x0 + w.x1) / 2, cy: (w.y0 + w.y1) / 2, used: false }));

  let tokens = 0, chords = 0;
  for (const row of rows) {
    const chordRow = isChordLine(row.tokens.map((t) => t.text));
    for (const token of row.tokens) {
      const slack = Math.min(3, (token.y1 - token.y0) * 0.25);
      const hits = wordList.filter((w) => !w.used
        && w.cx >= token.x0 - slack && w.cx <= token.x1 + slack
        && w.cy >= token.y0 && w.cy <= token.y1);
      if (!hits.length) continue;
      const tok = ids.group++;
      let text = token.text;
      let chord = chordRow && isChord(text);
      if (chordRow && !chord && uncertain && !/^[|%\-–]+$/.test(text)) {
        text = repairChord(text) || text;
        chord = true;
      }
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
        w.used = true;
        const tok = ids.group++;
        chords++;
        for (const p of w.pieces) Object.assign(p, { t: '?', tok, chord: '?' });
      }
    }
  }
  return { tokens, chords };
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
