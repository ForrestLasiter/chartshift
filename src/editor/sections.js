// Sections: named groups of pieces (Verse, Chorus, Bridge…) that can be
// selected, reordered, duplicated or removed as a unit. A piece belongs to a
// section through `piece.section`; `page.sections` holds the labels.
import { boundsOf } from '../lib/render.js';
import { isSectionHeader } from '../lib/chordpro.js';

const DEFAULT_GAP = 14;

export function installSections(ed) {
  const pages = () => ed.getState().pages;
  const replacePage = (pageIndex, page) => pages().map((p, i) => (i === pageIndex ? page : p));
  // Drop labels whose pieces are all gone.
  const prune = (page) => {
    const used = new Set(page.pieces.map((p) => p.section));
    return { ...page, sections: (page.sections || []).filter((s) => used.has(s.id)) };
  };

  /** Sections on a page with their bounds, top to bottom. */
  ed.sectionList = (pageIndex) => {
    const page = pages()[pageIndex];
    return (page.sections || [])
      .map((s) => ({ ...s, bounds: boundsOf(page.pieces.filter((p) => p.section === s.id)) }))
      .filter((s) => s.bounds)
      .sort((a, b) => a.bounds.y - b.bounds.y);
  };

  ed.makeSection = (label) => {
    const st = ed.getState();
    const pageIndex = st.activePage;
    const page = st.pages[pageIndex];
    const picked = ed.selectedOn(page);
    if (!picked.length) return ed.set({ status: 'Select the lines for the section first, then make it a section.' });
    const id = ed.ids.group++;
    const next = prune({
      ...page,
      pieces: page.pieces.map((p) => (st.selection.has(p.id) ? { ...p, section: id } : p)),
      sections: [...(page.sections || []), { id, label }],
    });
    ed.commit(replacePage(pageIndex, next), { status: `Section “${label}” made from ${picked.length} pieces.` });
  };

  ed.renameSection = (pageIndex, id, label) => {
    const page = pages()[pageIndex];
    const sections = page.sections.map((s) => (s.id === id ? { ...s, label } : s));
    ed.commit(replacePage(pageIndex, { ...page, sections }), { status: `Section renamed to “${label}”.` });
  };

  ed.selectSection = (pageIndex, id) => {
    ed.select(pages()[pageIndex].pieces.filter((p) => p.section === id).map((p) => p.id), { pageIndex });
  };

  ed.ungroupSection = (pageIndex, id) => {
    const page = pages()[pageIndex];
    const pieces = page.pieces.map((p) => {
      if (p.section !== id) return p;
      const { section, ...rest } = p;
      return rest;
    });
    ed.commit(replacePage(pageIndex, prune({ ...page, pieces })), { status: 'Section removed; its contents stay on the page.' });
  };

  // Swaps a section with its neighbour above or below, keeping the gap between them.
  ed.moveSection = (pageIndex, id, direction) => {
    const list = ed.sectionList(pageIndex);
    const i = list.findIndex((s) => s.id === id);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= list.length) return;
    const upper = list[Math.min(i, j)], lower = list[Math.max(i, j)];
    const gap = Math.max(0, lower.bounds.y - (upper.bounds.y + upper.bounds.h)) || DEFAULT_GAP / 2;
    const lowerShift = upper.bounds.y - lower.bounds.y;
    const upperShift = lower.bounds.h + gap;
    const page = pages()[pageIndex];
    const pieces = page.pieces.map((p) => {
      if (p.section === upper.id) return { ...p, y: p.y + upperShift };
      if (p.section === lower.id) return { ...p, y: p.y + lowerShift };
      return p;
    });
    ed.commit(replacePage(pageIndex, { ...page, pieces }), { status: `“${list[i].label}” moved ${direction < 0 ? 'up' : 'down'}.` });
  };

  const gapBelow = (list, section) => {
    const next = list[list.findIndex((s) => s.id === section.id) + 1];
    return next ? Math.max(4, next.bounds.y - (section.bounds.y + section.bounds.h)) : DEFAULT_GAP;
  };

  // Copies a section directly underneath itself and pushes the rest of the page down.
  ed.duplicateSection = (pageIndex, id) => {
    const list = ed.sectionList(pageIndex);
    const section = list.find((s) => s.id === id);
    if (!section) return;
    const shift = section.bounds.h + gapBelow(list, section);
    const bottom = section.bounds.y + section.bounds.h;
    const page = pages()[pageIndex];
    const newId = ed.ids.group++;
    const copies = ed.clonePieces(page.pieces.filter((p) => p.section === id), 0, shift, newId);
    const pieces = page.pieces.map((p) => (p.section !== id && !p.frame && p.y >= bottom - 1 ? { ...p, y: p.y + shift } : p));
    const next = { ...page, pieces: [...pieces, ...copies], sections: [...page.sections, { id: newId, label: section.label }] };
    const overflow = bottom + shift * 2 > page.h;
    ed.commit(replacePage(pageIndex, next), {
      selection: new Set(copies.map((c) => c.id)),
      status: `“${section.label}” duplicated below.${overflow ? ' Some content may now run past the bottom of the page.' : ''}`,
    });
  };

  // Deletes a section and closes the gap it leaves.
  ed.deleteSection = (pageIndex, id) => {
    const list = ed.sectionList(pageIndex);
    const section = list.find((s) => s.id === id);
    if (!section) return;
    const shift = section.bounds.h + gapBelow(list, section);
    const bottom = section.bounds.y + section.bounds.h;
    const page = pages()[pageIndex];
    const pieces = page.pieces
      .filter((p) => p.section !== id)
      .map((p) => (!p.frame && p.y >= bottom - 1 ? { ...p, y: p.y - shift } : p));
    ed.commit(replacePage(pageIndex, prune({ ...page, pieces })), { selection: new Set(), status: `“${section.label}” deleted and the gap closed.` });
  };

  // Finds headings like "Verse 1" or "Chorus" in the recognised text and makes
  // a section from each heading down to the next one.
  ed.autoSections = () => {
    let made = 0;
    const next = pages().map((page) => {
      const rows = new Map();
      for (const p of page.pieces) {
        const key = p.kind === 'text' ? `t${p.id}` : p.t ? `l${p.line}` : null;
        if (!key) continue;
        let row = rows.get(key);
        if (!row) rows.set(key, (row = { top: p.y, words: new Map() }));
        row.top = Math.min(row.top, p.y);
        if (p.kind === 'text') row.words.set(p.id, [p.x, p.text.split('\n')[0]]);
        else if (!row.words.has(p.tok)) row.words.set(p.tok, [p.x, p.t]);
      }
      const headers = [];
      for (const row of rows.values()) {
        const words = [...row.words.values()].sort((a, b) => a[0] - b[0]).map((w) => w[1]);
        const text = words.join(' ');
        if (words.length <= 4 && text.length <= 30 && isSectionHeader(text)) headers.push({ top: row.top, label: text.replace(/[:.]$/, '') });
      }
      if (!headers.length) return page;
      headers.sort((a, b) => a.top - b.top);
      headers.forEach((h, i) => { h.id = ed.ids.group++; h.end = headers[i + 1]?.top ?? Infinity; });
      const pieces = page.pieces.map((p) => {
        if (p.frame) return p;
        const middle = p.y + p.h / 2;
        const header = headers.find((h) => middle >= h.top - 1 && middle < h.end - 1);
        return header ? { ...p, section: header.id } : p;
      });
      made += headers.length;
      return prune({ ...page, pieces, sections: headers.map(({ id, label }) => ({ id, label })) });
    });
    if (made) ed.commit(next, { status: `Made ${made} section${made === 1 ? '' : 's'} from the headings.` });
    else ed.set({ status: 'No headings like “Verse” or “Chorus” were found in the recognised text. Select lines and use “Make section” instead.' });
  };
}
