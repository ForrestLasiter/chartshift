// Reading a page of word boxes the way a person does: split into columns,
// then into rows within each column. Used both to turn a chart into text and
// to look for chords. A word box is { text, x0, y0, x1, y1 } in page points.
import { findGutters } from './segment.js';

export const median = (values) => { const v = values.slice().sort((a, b) => a - b); return v.length ? v[v.length >> 1] : 0; };

/**
 * Where a page's columns divide. A chart set in two columns must be read down
 * the first and then down the second, never across. `hints` are the dividing
 * lines found on the song's other pages: a last page with only a few lines in
 * its second column is too thin to show a divide by itself, but if nothing
 * crosses where the other pages divide, it is divided there too.
 */
export function guttersOf(items, pageWidth, hints = []) {
  const height = median(items.map((item) => item.y1 - item.y0)) || 10;
  const boxes = items.map((item) => ({ x0: Math.max(0, Math.round(item.x0)), x1: Math.min(Math.ceil(pageWidth), Math.round(item.x1)), h: item.y1 - item.y0 }));
  const found = findGutters(boxes, Math.ceil(pageWidth), height, 0.05);
  if (found.length) return found;
  return hints.filter((x) => {
    const crossing = items.filter((item) => item.x0 < x && item.x1 > x).length;
    return crossing <= 1 && items.some((item) => item.x1 <= x) && items.some((item) => item.x0 >= x);
  });
}

/** The gutters of every page of a song, with thin pages borrowing from the others. `pages[i]` = { items, width }. */
export function guttersOfPages(pages) {
  const found = pages.map((page) => (page.items.length ? guttersOf(page.items, page.width) : []));
  return pages.map((page, i) => {
    if (found[i].length || !page.items.length) return found[i];
    const hints = found.filter((g, j) => j !== i && g.length && Math.abs(pages[j].width - page.width) < 2).flat();
    return guttersOf(page.items, page.width, [...new Set(hints.map(Math.round))].slice(0, 3));
  });
}

export function inColumns(items, gutters) {
  const columns = Array.from({ length: gutters.length + 1 }, () => []);
  for (const item of items) {
    const middle = (item.x0 + item.x1) / 2;
    let k = 0;
    while (k < gutters.length && middle > gutters[k]) k++;
    columns[k].push(item);
  }
  return columns.filter((column) => column.length);
}

/**
 * Groups a column's words into rows, top to bottom, each sorted left to right.
 * Words share a row when they overlap vertically, which copes with letters
 * that hang below the line.
 */
export function rowsOf(items) {
  const rows = [];
  for (const item of items.slice().sort((a, b) => a.y0 - b.y0)) {
    const height = item.y1 - item.y0;
    let home = null, most = 0;
    for (const row of rows) {
      const overlap = Math.min(item.y1, row.y1) - Math.max(item.y0, row.y0);
      if (overlap >= 0.5 * Math.min(height, row.y1 - row.y0) && overlap > most) { most = overlap; home = row; }
    }
    if (home) {
      home.items.push(item);
      // Tall or hanging letters must not stretch a row into its neighbours.
      if (height <= 1.6 * (home.y1 - home.y0)) { home.y0 = Math.min(home.y0, item.y0); home.y1 = Math.max(home.y1, item.y1); }
    } else rows.push({ y0: item.y0, y1: item.y1, items: [item] });
  }
  rows.sort((a, b) => a.y0 - b.y0);
  for (const row of rows) row.items.sort((a, b) => a.x0 - b.x0);
  return rows;
}
