import { fontCss, LINE_HEIGHT } from './text.js';

const SELECT_FILL = 'rgba(37, 99, 235, 0.18)';
const SELECT_STROKE = '#1d4ed8';
const GUIDE = '#db2777';
const CHORD_MARK = '#047857';

export function sectionColor(label) {
  if (/^verse/i.test(label)) return '#1d4ed8';
  if (/^(chorus|refrain)/i.test(label)) return '#047857';
  if (/^(bridge|pre)/i.test(label)) return '#b45309';
  return '#6b21a8';
}

// Where a piece is right now, including an in-progress drag or resize.
export function liveRect(piece, transient, selected, pageIndex) {
  if (!selected || !transient) return piece;
  const { move, scale } = transient;
  if (move) return { ...piece, x: piece.x + move.dx, y: piece.y + move.dy };
  if (scale && scale.page === pageIndex) {
    const { f, ox, oy } = scale;
    return {
      ...piece,
      x: ox + (piece.x - ox) * f,
      y: oy + (piece.y - oy) * f,
      w: piece.w * f,
      h: piece.h * f,
      ...(piece.kind === 'text' ? { size: piece.size * f } : null),
    };
  }
  return piece;
}

export function boundsOf(rects) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    if (r.x < x0) x0 = r.x;
    if (r.y < y0) y0 = r.y;
    if (r.x + r.w > x1) x1 = r.x + r.w;
    if (r.y + r.h > y1) y1 = r.y + r.h;
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function drawPiece(ctx, p, atlases) {
  if (p.kind === 'text') {
    ctx.font = fontCss(p);
    ctx.fillStyle = p.color;
    ctx.textBaseline = 'top';
    const lines = p.text.split('\n');
    const step = p.size * LINE_HEIGHT;
    // Centre each line's glyphs inside its line box, like a text field does.
    const inset = (step - p.size) / 2;
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], p.x, p.y + inset + i * step);
    return;
  }
  const atlas = atlases[p.atlas];
  if (atlas) ctx.drawImage(atlas, p.sx, p.sy, p.sw, p.sh, p.x, p.y, p.w, p.h);
}

/**
 * Draws one page. `scale` is canvas pixels per point.
 * With `view.decorate`, also draws selection, marquee and snap guides;
 * `view.px` is the size of one screen pixel in points.
 */
export function drawPage(ctx, page, atlases, view) {
  const { scale, selection, transient, hiddenId, pageIndex, decorate, showChords, px = 1 } = view;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const erased = transient?.erased;
  const live = [];
  const inSection = new Map();
  const chordRects = [];
  for (const piece of page.pieces) {
    if (piece.id === hiddenId || erased?.has(piece.id)) continue;
    const selected = !!selection?.has(piece.id);
    const r = liveRect(piece, transient, selected, pageIndex);
    drawPiece(ctx, r, atlases);
    if (!decorate) continue;
    if (selected) live.push(r);
    if (piece.section != null) {
      if (!inSection.has(piece.section)) inSection.set(piece.section, []);
      inSection.get(piece.section).push(r);
    }
    if (showChords && piece.chord) chordRects.push(r);
  }
  if (!decorate) return;

  // Section outlines with a name tag (editor only; never exported or printed).
  for (const section of page.sections || []) {
    const b = boundsOf(inSection.get(section.id) || []);
    if (!b) continue;
    const color = sectionColor(section.label);
    const pad = 5 * px;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 * px;
    ctx.strokeRect(b.x - pad, b.y - pad, b.w + 2 * pad, b.h + 2 * pad);
    ctx.font = `600 ${11 * px}px "Segoe UI", system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    const tagW = ctx.measureText(section.label).width + 10 * px, tagH = 16 * px;
    ctx.fillStyle = color;
    ctx.fillRect(b.x - pad, b.y - pad - tagH, tagW, tagH);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(section.label, b.x - pad + 5 * px, b.y - pad - tagH / 2);
  }

  if (chordRects.length) {
    ctx.fillStyle = CHORD_MARK;
    for (const r of chordRects) ctx.fillRect(r.x, r.y + r.h + 1.5 * px, r.w, 2 * px);
  }

  if (live.length) {
    ctx.fillStyle = SELECT_FILL;
    for (const r of live) ctx.fillRect(r.x, r.y, r.w, r.h);
    const b = boundsOf(live);
    ctx.strokeStyle = SELECT_STROKE;
    ctx.lineWidth = 1.5 * px;
    ctx.setLineDash([5 * px, 3 * px]);
    ctx.strokeRect(b.x - 2 * px, b.y - 2 * px, b.w + 4 * px, b.h + 4 * px);
    ctx.setLineDash([]);
    const hs = 5 * px;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(b.x + b.w - hs, b.y + b.h - hs, hs * 2, hs * 2);
    ctx.strokeRect(b.x + b.w - hs, b.y + b.h - hs, hs * 2, hs * 2);
  }

  const marquee = transient?.marquee;
  if (marquee && marquee.page === pageIndex) {
    const x = Math.min(marquee.x0, marquee.x1), y = Math.min(marquee.y0, marquee.y1);
    const w = Math.abs(marquee.x1 - marquee.x0), h = Math.abs(marquee.y1 - marquee.y0);
    ctx.fillStyle = 'rgba(37, 99, 235, 0.08)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = SELECT_STROKE;
    ctx.lineWidth = px;
    ctx.strokeRect(x, y, w, h);
  }

  const guides = transient?.guides;
  if (guides && guides.page === pageIndex) {
    ctx.strokeStyle = GUIDE;
    ctx.lineWidth = px;
    ctx.beginPath();
    if (guides.x != null) { ctx.moveTo(guides.x, 0); ctx.lineTo(guides.x, page.h); }
    if (guides.y != null) { ctx.moveTo(0, guides.y); ctx.lineTo(page.w, guides.y); }
    ctx.stroke();
  }
}

export function renderPageCanvas(page, atlases, dpi) {
  const scale = dpi / 72;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(page.w * scale);
  canvas.height = Math.round(page.h * scale);
  drawPage(canvas.getContext('2d'), page, atlases, { scale });
  return canvas;
}
