// Decides what sheet each page prints on. Most printers hold one paper size,
// so a song (or a setlist) whose pages differ in size or orientation needs a
// deliberate choice rather than whatever the first page happens to be.
// Sizes are in points (72 per inch). Pure functions, no DOM.

export const PAPERS = [
  { id: 'letter', label: 'Letter (8.5 × 11 in)', w: 612, h: 792 },
  { id: 'a4', label: 'A4 (210 × 297 mm)', w: 595.28, h: 841.89 },
  { id: 'legal', label: 'Legal (8.5 × 14 in)', w: 612, h: 1008 },
];

const same = (a, b) => Math.abs(a.w - b.w) <= 1 && Math.abs(a.h - b.h) <= 1;

/** The distinct page sizes in use, in first-seen order, with how many pages use each. */
export function pageSizes(pages) {
  const sizes = [];
  for (const page of pages) {
    const found = sizes.find((s) => same(s, page));
    if (found) found.count++;
    else sizes.push({ w: page.w, h: page.h, count: 1 });
  }
  return sizes;
}

export const isMixed = (pages) => pageSizes(pages).length > 1;

/**
 * choice: { mode: 'own' } prints every page on a sheet of its own size.
 *         { mode: 'paper', paper: {w, h} } prints everything on one paper size:
 *         each page is scaled to fit, and a page whose orientation differs
 *         from the paper is turned a quarter turn, as a printer would.
 * Returns one { w, h, rotate, scale } per page; w/h are the sheet size.
 */
export function planPrint(pages, choice) {
  if (choice.mode !== 'paper') return pages.map((page) => ({ w: page.w, h: page.h, rotate: false, scale: 1 }));
  const short = Math.min(choice.paper.w, choice.paper.h), long = Math.max(choice.paper.w, choice.paper.h);
  return pages.map((page) => {
    const rotate = page.w > page.h;
    const w = rotate ? page.h : page.w, h = rotate ? page.w : page.h;
    return { w: short, h: long, rotate, scale: Math.min(short / w, long / h) };
  });
}

/** Closest standard paper to the first page, to preselect in the dialog. */
export function nearestPaper(pages) {
  const first = pages[0];
  const short = Math.min(first.w, first.h), long = Math.max(first.w, first.h);
  let best = PAPERS[0], bestDistance = Infinity;
  for (const paper of PAPERS) {
    const distance = Math.abs(paper.w - short) + Math.abs(paper.h - long);
    if (distance < bestDistance) { best = paper; bestDistance = distance; }
  }
  return best;
}

/** What Print starts with: pages of one size print as they are; a mix is fitted to one paper. */
export function defaultChoice(pages) {
  return isMixed(pages) ? { mode: 'paper', paper: nearestPaper(pages) } : { mode: 'own' };
}

const inches = (points) => Math.round((points / 72) * 100) / 100;

/**
 * Where a page's picture sits on its sheet, exactly as the printer lays it
 * out: turned if the plan says so, scaled to fit, and centred. All in points.
 */
export function placeOnSheet(page, sheet) {
  const w = sheet.rotate ? page.h : page.w, h = sheet.rotate ? page.w : page.h;
  const scale = Math.min(sheet.w / w, sheet.h / h);
  return { x: (sheet.w - w * scale) / 2, y: (sheet.h - h * scale) / 2, w: w * scale, h: h * scale, scale };
}

/** Words for a sheet, for captions and screen readers: "8.5 × 11 in portrait, scaled to 77%, turned sideways". */
export function describeSheet(page, sheet) {
  const { scale } = placeOnSheet(page, sheet);
  const parts = [`${inches(sheet.w)} × ${inches(sheet.h)} in ${sheet.w > sheet.h ? 'landscape' : 'portrait'}`];
  if (Math.abs(scale - 1) > 0.005) parts.push(`scaled to ${Math.round(scale * 100)}%`);
  if (sheet.rotate) parts.push('turned sideways');
  return parts.join(', ');
}
