// Whole-page layout tools: shrink a song onto one page, or enlarge it for
// easier reading. `remeasure` re-sizes a text box after its font size changes.
import { boundsOf } from './render.js';

const MARGIN = 36;

function scalePiece(p, f, fromX, fromY, toX, toY, remeasure) {
  const next = { ...p, x: toX + (p.x - fromX) * f, y: toY + (p.y - fromY) * f, w: p.w * f, h: p.h * f };
  if (p.kind === 'text') {
    next.size = Math.max(4, Math.round(p.size * f * 10) / 10);
    Object.assign(next, remeasure(next));
  }
  return next;
}

const mergeSections = (pages) => {
  const seen = new Map();
  for (const page of pages) for (const s of page.sections || []) if (!seen.has(s.id)) seen.set(s.id, s);
  return [...seen.values()];
};

/** Stacks every page's content and scales it to fit on the first page. */
export function fitToOnePage(pages, remeasure) {
  const filled = pages.filter((page) => page.pieces.some((p) => !p.frame));
  if (!filled.length) return null;
  const parts = filled.map((page) => ({ page, b: boundsOf(page.pieces.filter((p) => !p.frame)) }));
  const gap = 14;
  const left = Math.min(...parts.map((part) => part.b.x));
  const width = Math.max(...parts.map((part) => part.b.x + part.b.w)) - left;
  const height = parts.reduce((sum, part) => sum + part.b.h, 0) + gap * (parts.length - 1);
  const target = pages[0];
  const f = Math.min(1, (target.w - 2 * MARGIN) / width, (target.h - 2 * MARGIN) / height);
  if (pages.length === 1 && f === 1) return null;
  const pieces = [];
  let offset = 0;
  for (const { page, b } of parts) {
    for (const p of page.pieces) {
      if (p.frame) continue;
      pieces.push(scalePiece(p, f, left, b.y, MARGIN, MARGIN + offset * f, remeasure));
    }
    offset += b.h + gap;
  }
  return { pages: [{ ...target, pieces, sections: mergeSections(pages) }], scale: f };
}

/**
 * Enlarges everything by up to `factor`, limited by the page width, and moves
 * whatever no longer fits onto following pages. `newPageId` supplies page ids.
 */
export function enlarge(pages, factor, remeasure, newPageId) {
  let widest = 0;
  for (const page of pages) {
    const b = boundsOf(page.pieces.filter((p) => !p.frame));
    if (b) widest = Math.max(widest, b.w / (page.w - 2 * MARGIN));
  }
  if (!widest) return null;
  const f = Math.min(factor, 1 / widest);
  if (f < 1.04) return null;
  const out = [];
  for (const page of pages) {
    const content = page.pieces.filter((p) => !p.frame);
    const b = boundsOf(content);
    if (!b) { out.push(page); continue; }
    const top = Math.min(b.y, MARGIN);
    let rest = content.map((p) => scalePiece(p, f, b.x, b.y, MARGIN, top, remeasure));
    const limit = page.h - MARGIN / 2;
    let current = { ...page, pieces: [] };
    for (let guard = 0; guard < 20; guard++) {
      // Keep whole blocks together when pushing overflow to the next page.
      const groups = new Map();
      for (const p of rest) {
        const key = p.kind === 'clip' ? `b${p.block}` : `t${p.id}`;
        const g = groups.get(key);
        if (!g) groups.set(key, { top: p.y, bottom: p.y + p.h });
        else { g.top = Math.min(g.top, p.y); g.bottom = Math.max(g.bottom, p.y + p.h); }
      }
      let cut = Infinity;
      for (const g of groups.values()) if (g.bottom > limit && g.top > MARGIN + 1) cut = Math.min(cut, g.top);
      const stay = [], move = [];
      for (const p of rest) {
        const g = groups.get(p.kind === 'clip' ? `b${p.block}` : `t${p.id}`);
        (g.top >= cut ? move : stay).push(p);
      }
      current.pieces = stay;
      out.push(current);
      if (!move.length) break;
      const shift = cut - MARGIN;
      rest = move.map((p) => ({ ...p, y: p.y - shift }));
      current = { id: newPageId(), w: page.w, h: page.h, pieces: [], sections: page.sections };
    }
  }
  return { pages: out, scale: f };
}
