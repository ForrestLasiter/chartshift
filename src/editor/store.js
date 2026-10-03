// Editor state: the pages and their pieces, selection, tools and undo history.
// Pages and pieces are never mutated in place, so an undo step is just the
// previous `pages` array.
import { useSyncExternalStore } from 'react';
import { DEFAULT_TEXT_STYLE, measureText } from '../lib/text.js';
import { boundsOf } from '../lib/render.js';
import { installSections } from './sections.js';
import { installMusic } from './music.js';

const MAX_UNDO = 200;
export const LEVELS = ['section', 'block', 'line', 'word', 'letter'];

export function createEditor() {
  const subscribers = new Set();
  const drawSubscribers = new Set();
  const undoStack = [];
  const redoStack = [];

  let state = {
    pages: null,
    selection: new Set(),
    level: 'line',
    tool: 'select',
    zoom: 1,
    activePage: 0,
    editing: null, // { pageIndex, piece, isNew }
    textStyle: { ...DEFAULT_TEXT_STYLE },
    name: '',
    savedAs: null, // name in the library, once saved there
    showChords: true,
    dirty: false,
    busy: '',
    status: 'Open a PDF, image or song to begin.',
    canUndo: false,
    canRedo: false,
  };

  const ed = {
    atlases: [],
    ids: { piece: 1, group: 1, page: 1 },
    // In-progress drag state, read directly by the canvases while drawing.
    transient: {},
    clipboard: null,
    editingText: '',
  };

  const set = (patch) => {
    state = { ...state, ...patch, canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 };
    subscribers.forEach((fn) => fn());
  };
  const commit = (pages, patch = {}) => {
    undoStack.push(state.pages);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
    set({ pages, dirty: true, ...patch });
  };

  ed.getState = () => state;
  ed.subscribe = (fn) => { subscribers.add(fn); return () => subscribers.delete(fn); };
  ed.onDraw = (fn) => { drawSubscribers.add(fn); return () => drawSubscribers.delete(fn); };
  let drawQueued = false;
  ed.requestDraw = () => {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => {
      drawQueued = false;
      drawSubscribers.forEach((fn) => fn());
    });
  };
  ed.set = set;

  ed.setDoc = ({ pages, atlases, ids, name, savedAs = null, status }) => {
    ed.atlases = atlases;
    ed.ids = ids;
    ed.transient = {};
    undoStack.length = 0;
    redoStack.length = 0;
    set({ pages, selection: new Set(), activePage: 0, editing: null, name, savedAs, dirty: false, status });
  };

  const selectedOn = (page) => page.pieces.filter((p) => state.selection.has(p.id));
  const countLabel = (n) => `${n} piece${n === 1 ? '' : 's'}`;
  ed.commit = commit;
  ed.selectedOn = selectedOn;

  // What a click grabs at each level. Sections fall back to blocks for
  // pieces that are not in a section; text boxes are their own group.
  const groupKey = (p, level) => {
    if (level === 'section' && p.section != null) return `s${p.section}`;
    if (p.kind !== 'clip' || level === 'letter') return `id:${p.id}`;
    return level === 'section' ? `b${p.block}` : `${level[0]}${p[level]}`;
  };

  // --- selection ---------------------------------------------------------

  // Widens pieces to their whole letter/word/line/block at the current level.
  ed.expand = (pageIndex, pieces) => {
    const level = state.level;
    if (level === 'letter') return pieces.map((p) => p.id);
    const keys = new Set(pieces.map((p) => groupKey(p, level)));
    return state.pages[pageIndex].pieces.filter((p) => keys.has(groupKey(p, level))).map((p) => p.id);
  };

  // Keyboard selection: step to the next or previous group in reading order.
  ed.selectStep = (direction) => {
    const page = state.pages?.[state.activePage];
    if (!page) return;
    const groups = new Map();
    for (const p of page.pieces) {
      if (p.frame) continue;
      const key = groupKey(p, state.level);
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { key, ids: [], x: p.x, y: p.y, words: new Map() }));
      g.ids.push(p.id);
      g.x = Math.min(g.x, p.x);
      g.y = Math.min(g.y, p.y);
      if (p.kind === 'text') g.words.set(p.id, [p.x, p.y, p.text]);
      else if (p.t && !g.words.has(p.tok)) g.words.set(p.tok, [p.x, p.y + p.h, p.t]);
    }
    const list = [...groups.values()].sort((a, b) => (Math.abs(a.y - b.y) > 4 ? a.y - b.y : a.x - b.x));
    if (!list.length) return;
    const current = list.findIndex((g) => g.ids.some((id) => state.selection.has(id)));
    const next = list[current < 0 ? (direction > 0 ? 0 : list.length - 1) : (current + direction + list.length) % list.length];
    const text = [...next.words.values()]
      .sort((a, b) => (Math.abs(a[1] - b[1]) > 5 ? a[1] - b[1] : a[0] - b[0]))
      .map((w) => w[2]).join(' ').slice(0, 80);
    set({
      selection: new Set(next.ids),
      status: `Selected ${state.level} ${list.indexOf(next) + 1} of ${list.length}${text ? `: ${text}` : ''}.`,
    });
  };

  ed.select = (ids, { add = false, toggle = false, pageIndex } = {}) => {
    let selection;
    if (toggle) {
      selection = new Set(state.selection);
      const allIn = ids.every((id) => selection.has(id));
      for (const id of ids) { if (allIn) selection.delete(id); else selection.add(id); }
    } else if (add) {
      selection = new Set([...state.selection, ...ids]);
    } else {
      selection = new Set(ids);
    }
    set({
      selection,
      activePage: pageIndex ?? state.activePage,
      status: selection.size ? `${countLabel(selection.size)} selected.` : 'Nothing selected.',
    });
  };

  ed.selectAll = () => {
    const page = state.pages?.[state.activePage];
    if (page) ed.select(page.pieces.map((p) => p.id));
  };

  ed.hitTest = (pageIndex, x, y, slop) => {
    let best = null, bestArea = Infinity;
    for (const p of state.pages[pageIndex].pieces) {
      if (x < p.x - slop || x > p.x + p.w + slop || y < p.y - slop || y > p.y + p.h + slop) continue;
      if (p.frame) {
        // Page-sized boxes only respond near their edges, so they don't block everything inside.
        const edge = 6;
        const inner = x > p.x + edge && x < p.x + p.w - edge && y > p.y + edge && y < p.y + p.h - edge;
        if (inner) continue;
      }
      const area = p.w * p.h;
      if (area < bestArea) { best = p; bestArea = area; }
    }
    return best;
  };

  ed.selectionBounds = (pageIndex) => boundsOf(selectedOn(state.pages[pageIndex]));

  // --- editing -----------------------------------------------------------

  const mapSelected = (fn) => state.pages.map((page, pageIndex) => {
    let changed = false;
    const pieces = page.pieces.map((p) => {
      if (!state.selection.has(p.id)) return p;
      changed = true;
      return fn(p, pageIndex);
    });
    return changed ? { ...page, pieces } : page;
  });

  ed.moveSelection = (dx, dy) => {
    if (!state.selection.size || (!dx && !dy)) return;
    commit(mapSelected((p) => ({ ...p, x: p.x + dx, y: p.y + dy })), { status: `Moved ${countLabel(state.selection.size)}.` });
  };

  ed.scaleSelection = (pageIndex, f, ox, oy) => {
    if (f === 1) return;
    const pages = mapSelected((p, i) => {
      if (i !== pageIndex) return p;
      const scaled = { ...p, x: ox + (p.x - ox) * f, y: oy + (p.y - oy) * f, w: p.w * f, h: p.h * f };
      if (p.kind === 'text') {
        scaled.size = Math.max(4, Math.round(p.size * f * 10) / 10);
        Object.assign(scaled, measureText(scaled));
      }
      return scaled;
    });
    commit(pages, { status: `Resized to ${Math.round(f * 100)}%.` });
  };

  ed.deleteIds = (ids, label) => {
    if (!ids.size) return;
    const pages = state.pages.map((page) => {
      const pieces = page.pieces.filter((p) => !ids.has(p.id));
      return pieces.length === page.pieces.length ? page : { ...page, pieces };
    });
    const selection = new Set([...state.selection].filter((id) => !ids.has(id)));
    commit(pages, { selection, status: label ?? `Deleted ${countLabel(ids.size)}.` });
  };

  ed.deleteSelection = () => ed.deleteIds(state.selection);

  // Copies get fresh ids, and fresh group ids so a copied line selects on its own.
  const clonePieces = (pieces, dx, dy, section) => {
    const remap = { word: new Map(), line: new Map(), block: new Map(), tok: new Map() };
    const fresh = (kind, value) => {
      if (!remap[kind].has(value)) remap[kind].set(value, ed.ids.group++);
      return remap[kind].get(value);
    };
    return pieces.map((p) => {
      const copy = { ...p, id: ed.ids.piece++, x: p.x + dx, y: p.y + dy };
      if (p.kind === 'clip') Object.assign(copy, { word: fresh('word', p.word), line: fresh('line', p.line), block: fresh('block', p.block) });
      if (p.tok != null) copy.tok = fresh('tok', p.tok);
      // Copies leave their section unless a whole section is being copied.
      if (section != null) copy.section = section; else delete copy.section;
      return copy;
    });
  };
  ed.clonePieces = clonePieces;

  ed.duplicateSelection = () => {
    if (!state.selection.size) return;
    const selection = new Set();
    const pages = state.pages.map((page) => {
      const picked = selectedOn(page);
      if (!picked.length) return page;
      const copies = clonePieces(picked, 10, 10);
      copies.forEach((c) => selection.add(c.id));
      return { ...page, pieces: [...page.pieces, ...copies] };
    });
    commit(pages, { selection, status: `Duplicated ${countLabel(selection.size)}.` });
  };

  ed.copy = () => {
    const picked = state.pages.flatMap(selectedOn);
    if (!picked.length) return;
    ed.clipboard = picked;
    set({ status: `Copied ${countLabel(picked.length)}.` });
  };

  ed.cut = () => { ed.copy(); ed.deleteSelection(); };

  ed.paste = () => {
    if (!ed.clipboard?.length || !state.pages) return;
    const copies = clonePieces(ed.clipboard, 10, 10);
    ed.clipboard = copies; // repeated pastes step down the page
    const pages = state.pages.map((page, i) =>
      i === state.activePage ? { ...page, pieces: [...page.pieces, ...copies] } : page);
    commit(pages, { selection: new Set(copies.map((c) => c.id)), status: `Pasted ${countLabel(copies.length)} on page ${state.activePage + 1}.` });
  };

  ed.undo = () => {
    if (!undoStack.length) return;
    redoStack.push(state.pages);
    const pages = undoStack.pop();
    set({ pages, selection: new Set(), editing: null, dirty: true, activePage: Math.min(state.activePage, pages.length - 1), status: 'Undone.' });
  };

  ed.redo = () => {
    if (!redoStack.length) return;
    undoStack.push(state.pages);
    const pages = redoStack.pop();
    set({ pages, selection: new Set(), editing: null, dirty: true, activePage: Math.min(state.activePage, pages.length - 1), status: 'Redone.' });
  };

  // --- text boxes --------------------------------------------------------

  ed.beginNewText = (pageIndex, x, y) => {
    const piece = { id: ed.ids.piece++, kind: 'text', x, y, text: '', ...state.textStyle };
    Object.assign(piece, measureText(piece));
    ed.editingText = '';
    set({ editing: { pageIndex, piece, isNew: true }, selection: new Set(), activePage: pageIndex, status: 'Type your text, then click away or press Escape.' });
  };

  ed.beginEditText = (pageIndex, piece) => {
    ed.editingText = piece.text;
    set({ editing: { pageIndex, piece, isNew: false }, selection: new Set([piece.id]), activePage: pageIndex, status: 'Editing text.' });
  };

  // `onlyId` lets a late blur event from an old text field be ignored.
  ed.endEdit = (onlyId) => {
    const editing = state.editing;
    if (!editing || (onlyId != null && editing.piece.id !== onlyId)) return;
    const { pageIndex, isNew } = editing;
    const text = ed.editingText.replace(/\s+$/, '');
    const piece = { ...editing.piece, text };
    Object.assign(piece, measureText(piece));
    const replacePieces = (fn) => state.pages.map((page, i) => (i === pageIndex ? { ...page, pieces: fn(page.pieces) } : page));
    if (!text) {
      if (isNew) set({ editing: null, status: 'Empty text box discarded.' });
      else commit(replacePieces((list) => list.filter((p) => p.id !== piece.id)), { editing: null, selection: new Set(), status: 'Text box removed.' });
    } else if (isNew) {
      commit(replacePieces((list) => [...list, piece]), { editing: null, selection: new Set([piece.id]), status: 'Text box added.' });
    } else if (text !== editing.piece.text) {
      commit(replacePieces((list) => list.map((p) => (p.id === piece.id ? piece : p))), { editing: null, status: 'Text updated.' });
    } else {
      set({ editing: null });
    }
  };

  // Applies to the box being typed in, any selected text boxes, and future boxes.
  ed.setTextStyle = (patch) => {
    const textStyle = { ...state.textStyle, ...patch };
    const restyle = (p) => {
      const next = { ...p, ...patch };
      return { ...next, ...measureText(next) };
    };
    if (state.editing) {
      set({ textStyle, editing: { ...state.editing, piece: restyle({ ...state.editing.piece, text: ed.editingText }) } });
      return;
    }
    const hasText = state.pages?.some((page) => selectedOn(page).some((p) => p.kind === 'text'));
    if (hasText) commit(mapSelected((p) => (p.kind === 'text' ? restyle(p) : p)), { textStyle, status: 'Text style changed.' });
    else set({ textStyle });
  };

  // --- pages -------------------------------------------------------------

  ed.addPage = (afterIndex) => {
    const like = state.pages[afterIndex];
    const pages = state.pages.slice();
    pages.splice(afterIndex + 1, 0, { id: ed.ids.page++, w: like.w, h: like.h, pieces: [], sections: [] });
    commit(pages, { activePage: afterIndex + 1, status: `Blank page added after page ${afterIndex + 1}.` });
  };

  ed.deletePage = (index) => {
    if (state.pages.length < 2) return;
    const pages = state.pages.filter((_, i) => i !== index);
    commit(pages, { selection: new Set(), activePage: Math.min(index, pages.length - 1), status: `Page ${index + 1} deleted.` });
  };

  ed.movePage = (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= state.pages.length) return;
    const pages = state.pages.slice();
    [pages[index], pages[target]] = [pages[target], pages[index]];
    commit(pages, { activePage: target, status: `Page moved to position ${target + 1}.` });
  };

  ed.appendPages = (newPages) => {
    commit([...state.pages, ...newPages], { status: `Added ${newPages.length} page${newPages.length === 1 ? '' : 's'}.` });
  };

  // Stray dots left over from a scan: tiny pieces sitting alone, away from any
  // text row. Dots inside a staff are left alone (they are usually music).
  ed.removeSpecks = () => {
    const ids = new Set();
    for (const page of state.pages) {
      const rows = new Map();
      for (const p of page.pieces) if (p.kind === 'clip') rows.set(p.line, (rows.get(p.line) || 0) + 1);
      for (const p of page.pieces) {
        if (p.kind === 'clip' && !p.contained && !p.t && Math.max(p.w, p.h) < 2.4 && rows.get(p.line) <= 2) ids.add(p.id);
      }
    }
    if (ids.size) ed.deleteIds(ids, `Removed ${ids.size} speck${ids.size === 1 ? '' : 's'}.`);
    else set({ status: 'No specks found.' });
  };

  installSections(ed);
  installMusic(ed);
  return ed;
}

export function useEditorState(editor) {
  return useSyncExternalStore(editor.subscribe, editor.getState);
}
