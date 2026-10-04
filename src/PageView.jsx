import { useCallback, useEffect, useRef, useState } from 'react';
import { drawPage } from './lib/render.js';
import { fontCss, LINE_HEIGHT, measureText } from './lib/text.js';
import { Icon } from './icons.jsx';
import { IconButton } from './ui.jsx';

const DRAG_START_PX = 3;
const SNAP_PX = 5;
const SCROLL_EDGE_PX = 40;
const SCROLL_SPEED_PX = 16;

// Which page (if any) is under a point on the screen.
function pageAt(clientX, clientY) {
  const canvases = document.querySelectorAll('.sheet canvas');
  for (let i = 0; i < canvases.length; i++) {
    const rect = canvases[i].getBoundingClientRect();
    if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) return { index: i, rect };
  }
  return null;
}

function nearest(values, target) {
  let best = null, bestDiff = Infinity;
  for (const value of values) {
    const diff = Math.abs(value - target);
    if (diff < bestDiff) { bestDiff = diff; best = value; }
  }
  return { value: best, diff: bestDiff };
}

function TextEditor({ editor, piece, zoom }) {
  const [text, setText] = useState(editor.editingText);
  const ref = useRef(null);
  useEffect(() => {
    const field = ref.current;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, []);
  const size = measureText({ ...piece, text: text || ' ' });
  return (
    <textarea
      ref={ref}
      className="text-editor"
      aria-label="Text box contents"
      wrap="off"
      spellCheck={false}
      value={text}
      style={{
        left: piece.x * zoom,
        top: piece.y * zoom,
        width: (size.w + piece.size) * zoom,
        height: size.h * zoom,
        font: fontCss(piece, zoom),
        lineHeight: LINE_HEIGHT,
        color: piece.color,
      }}
      onChange={(e) => { editor.editingText = e.target.value; setText(e.target.value); }}
      onBlur={() => editor.endEdit(piece.id)}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') e.target.blur(); }}
    />
  );
}

export function PageView({ editor, state, page, index, pageCount }) {
  const canvasRef = useRef(null);
  const drag = useRef(null);
  const { zoom, selection, editing, tool, showChords } = state;
  const hiddenId = editing?.piece.id;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(page.w * zoom * dpr), h = Math.round(page.h * zoom * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    // A drag that has crossed onto this page: preview the pieces arriving.
    const cross = editor.transient.cross;
    const st = editor.getState();
    const incoming = cross && cross.to === index && st.pages[cross.from]
      ? { pieces: st.pages[cross.from].pieces.filter((p) => st.selection.has(p.id)), dx: editor.transient.move.dx + cross.ox, dy: editor.transient.move.dy + cross.oy }
      : null;
    drawPage(canvas.getContext('2d'), page, editor.atlases, {
      scale: w / page.w, selection, transient: editor.transient, hiddenId, pageIndex: index, decorate: true, showChords, incoming, px: 1 / zoom,
    });
  }, [editor, page, zoom, selection, hiddenId, index, showChords]);

  useEffect(draw, [draw]);
  useEffect(() => editor.onDraw(draw), [editor, draw]);

  const toPage = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom };
  };

  const overHandle = (pt) => {
    if (!editor.getState().selection.size) return null;
    const b = editor.selectionBounds(index);
    const reach = 7 / zoom;
    return b && Math.abs(pt.x - (b.x + b.w)) <= reach && Math.abs(pt.y - (b.y + b.h)) <= reach ? b : null;
  };

  // Edges of the other lines on this page, for the selection to snap against.
  const buildSnap = () => {
    const st = editor.getState();
    const b = editor.selectionBounds(index);
    if (!b) return null;
    const rows = new Map();
    for (const p of page.pieces) {
      if (st.selection.has(p.id) || p.frame) continue;
      const key = p.kind === 'clip' ? p.line : `id:${p.id}`;
      const row = rows.get(key);
      if (!row) rows.set(key, { x: p.x, top: p.y, bottom: p.y + p.h });
      else {
        row.x = Math.min(row.x, p.x);
        row.top = Math.min(row.top, p.y);
        row.bottom = Math.max(row.bottom, p.y + p.h);
      }
    }
    const list = [...rows.values()];
    return { b, xs: list.map((r) => r.x), tops: list.map((r) => r.top), bottoms: list.map((r) => r.bottom) };
  };

  const eraseAt = (pt) => {
    const hit = editor.hitTest(index, pt.x, pt.y, 1 / zoom);
    if (hit && !editor.transient.erased.has(hit.id)) {
      editor.transient.erased.add(hit.id);
      editor.requestDraw();
    }
  };

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    if (editor.getState().editing) editor.endEdit();
    const st = editor.getState();
    const pt = toPage(e);
    const slop = 3 / zoom;

    if (st.tool === 'text') {
      const hit = editor.hitTest(index, pt.x, pt.y, slop);
      if (hit?.kind === 'text') editor.beginEditText(index, hit);
      else editor.beginNewText(index, pt.x, pt.y - (st.textStyle.size * LINE_HEIGHT) / 2);
      return;
    }

    const canvas = canvasRef.current;
    canvas.focus({ preventScroll: true });
    try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }

    if (st.tool === 'erase') {
      editor.transient = { erased: new Set() };
      drag.current = { mode: 'erase' };
      editor.set({ activePage: index });
      eraseAt(pt);
      return;
    }

    const handle = overHandle(pt);
    if (handle) {
      drag.current = { mode: 'scale', b: handle };
      return;
    }
    const hit = editor.hitTest(index, pt.x, pt.y, slop);
    if (hit) {
      const ids = editor.expand(index, [hit]);
      if (e.shiftKey || e.ctrlKey) editor.select(ids, { toggle: true, pageIndex: index });
      else if (!st.selection.has(hit.id)) editor.select(ids, { pageIndex: index });
      else editor.set({ activePage: index });
      drag.current = { mode: 'move', start: pt, sx: e.clientX, sy: e.clientY, moved: false, snap: null };
    } else {
      if (!e.shiftKey) editor.select([], { pageIndex: index });
      drag.current = { mode: 'marquee', start: pt, add: e.shiftKey };
    }
  };

  // Updates an in-progress move from the last known pointer position. Called on
  // pointer movement and again while the view scrolls under a still pointer.
  const applyMove = (d) => {
    const { clientX, clientY, shiftKey, altKey } = d.last;
    const rect = canvasRef.current.getBoundingClientRect();
    let dx = (clientX - rect.left) / zoom - d.start.x, dy = (clientY - rect.top) / zoom - d.start.y;
    // Over another page: the pieces will land there, at the pointer.
    const over = pageAt(clientX, clientY);
    if (over && over.index !== index) {
      editor.transient = { move: { dx, dy }, cross: { from: index, to: over.index, ox: (rect.left - over.rect.left) / zoom, oy: (rect.top - over.rect.top) / zoom } };
      editor.requestDraw();
      return;
    }
    let lockX = false, lockY = false;
    if (shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) { dy = 0; lockY = true; } else { dx = 0; lockX = true; }
    }
    let guides = null;
    if (!altKey && d.snap) {
      const { b, xs, tops, bottoms } = d.snap;
      const tol = SNAP_PX / zoom;
      guides = { page: index };
      if (!lockX) {
        const left = nearest(xs, b.x + dx);
        if (left.diff < tol) { dx = left.value - b.x; guides.x = left.value; }
      }
      if (!lockY) {
        const bottom = nearest(bottoms, b.y + b.h + dy);
        const top = nearest(tops, b.y + dy);
        if (bottom.diff < tol && bottom.diff <= top.diff) { dy = bottom.value - b.y - b.h; guides.y = bottom.value; }
        else if (top.diff < tol) { dy = top.value - b.y; guides.y = top.value; }
      }
    }
    editor.transient = { move: { dx, dy }, guides };
    editor.requestDraw();
  };

  // While dragging near an edge of the work area, scroll so that pages which
  // are out of view (below, or beside) can be reached.
  const autoScroll = () => {
    const d = drag.current;
    if (!d || d.mode !== 'move' || !d.last) return;
    const area = document.getElementById('workspace');
    const r = area.getBoundingClientRect();
    const { clientX, clientY } = d.last;
    const sx = clientX < r.left + SCROLL_EDGE_PX ? -SCROLL_SPEED_PX : clientX > r.right - SCROLL_EDGE_PX ? SCROLL_SPEED_PX : 0;
    const sy = clientY < r.top + SCROLL_EDGE_PX ? -SCROLL_SPEED_PX : clientY > r.bottom - SCROLL_EDGE_PX ? SCROLL_SPEED_PX : 0;
    if (sx || sy) {
      const before = [area.scrollLeft, area.scrollTop];
      area.scrollBy(sx, sy);
      if (before[0] !== area.scrollLeft || before[1] !== area.scrollTop) applyMove(d);
    }
    d.raf = requestAnimationFrame(autoScroll);
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    const pt = toPage(e);
    if (!d) {
      let cursor = 'default';
      if (tool === 'text') cursor = 'text';
      else if (tool === 'erase') cursor = 'cell';
      else if (overHandle(pt)) cursor = 'nwse-resize';
      else if (editor.hitTest(index, pt.x, pt.y, 3 / zoom)) cursor = 'move';
      canvasRef.current.style.cursor = cursor;
      return;
    }
    if (d.mode === 'erase') return eraseAt(pt);
    if (d.mode === 'move') {
      d.last = { clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey, altKey: e.altKey };
      if (!d.moved) {
        if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < DRAG_START_PX) return;
        d.moved = true;
        d.snap = buildSnap();
        d.raf = requestAnimationFrame(autoScroll);
      }
      return applyMove(d);
    }
    if (d.mode === 'scale') {
      const f = Math.max(0.1, (pt.x - d.b.x) / d.b.w, (pt.y - d.b.y) / d.b.h);
      editor.transient = { scale: { page: index, f, ox: d.b.x, oy: d.b.y } };
    } else if (d.mode === 'marquee') {
      editor.transient = { marquee: { page: index, x0: d.start.x, y0: d.start.y, x1: pt.x, y1: pt.y } };
    }
    editor.requestDraw();
  };

  const onPointerUp = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (d.raf) cancelAnimationFrame(d.raf);
    const t = editor.transient;
    editor.transient = {};
    if (d.mode === 'move' && t.move && t.cross) {
      editor.moveSelectionToPage(t.cross.from, t.cross.to, t.move.dx + t.cross.ox, t.move.dy + t.cross.oy, t.move.dx, t.move.dy);
      // Keyboard focus follows the pieces to their new page.
      document.querySelectorAll('.sheet canvas')[t.cross.to]?.focus({ preventScroll: true });
      editor.requestDraw();
    } else if (d.mode === 'move' && t.move) editor.moveSelection(t.move.dx, t.move.dy);
    else if (d.mode === 'scale' && t.scale) editor.scaleSelection(index, t.scale.f, t.scale.ox, t.scale.oy);
    else if (d.mode === 'erase' && t.erased?.size) editor.deleteIds(t.erased, `Erased ${t.erased.size} piece${t.erased.size === 1 ? '' : 's'}.`);
    else if (d.mode === 'marquee' && t.marquee) {
      const m = t.marquee;
      const x0 = Math.min(m.x0, m.x1), x1 = Math.max(m.x0, m.x1), y0 = Math.min(m.y0, m.y1), y1 = Math.max(m.y0, m.y1);
      const inside = page.pieces.filter((p) => {
        if (p.frame) return p.x >= x0 && p.y >= y0 && p.x + p.w <= x1 && p.y + p.h <= y1;
        const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
        return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
      });
      if (inside.length) editor.select(editor.expand(index, inside), { add: d.add, pageIndex: index });
      else editor.requestDraw();
    } else editor.requestDraw();
  };

  const onDoubleClick = (e) => {
    const pt = toPage(e);
    const hit = editor.hitTest(index, pt.x, pt.y, 3 / zoom);
    if (hit?.kind === 'text') editor.beginEditText(index, hit);
  };

  const label = `Page ${index + 1}`;
  return (
    <section className={`page${state.activePage === index ? ' active' : ''}`} aria-label={label}>
      <header className="page-bar">
        <h2>{label} of {pageCount}</h2>
        <div className="page-actions">
          <button type="button" className="btn" onClick={() => editor.addPage(index)} aria-label={`Add a blank page after page ${index + 1}`}><Icon name="plus" size={14} />Add page</button>
          <IconButton icon="arrowUp" label={`Move page ${index + 1} up`} onClick={() => editor.movePage(index, -1)} disabled={index === 0} />
          <IconButton icon="arrowDown" label={`Move page ${index + 1} down`} onClick={() => editor.movePage(index, 1)} disabled={index === pageCount - 1} />
          <IconButton icon="trash" label={`Delete page ${index + 1}`} onClick={() => editor.deletePage(index)} disabled={pageCount < 2} />
        </div>
      </header>
      <div className="sheet" style={{ width: page.w * zoom, height: page.h * zoom }}>
        <canvas
          ref={canvasRef}
          tabIndex={0}
          role="application"
          aria-roledescription="page editor"
          aria-label={`${label} editing surface, ${page.pieces.length} pieces. Press period or comma to select the next or previous ${state.level}, arrow keys to move it, Delete to remove it.`}
          style={{ width: page.w * zoom, height: page.h * zoom }}
          onMouseDown={(e) => e.preventDefault()}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
          onFocus={() => { if (editor.getState().activePage !== index) editor.set({ activePage: index }); }}
        />
        {editing && editing.pageIndex === index && (
          <TextEditor key={editing.piece.id} editor={editor} piece={editing.piece} zoom={zoom} />
        )}
      </div>
    </section>
  );
}
