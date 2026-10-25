// A church's own hymnal, as its index gives it: song numbers (or pages) and
// titles, matched to the hymns in the library so a song can be found by the
// number on the board. Pure, no DOM.

/** Text for comparing titles: lower case, letters and digits only, "oh" as "o". */
export function normalTitle(text) {
  return String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[’']/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ')
    .replace(/\boh\b/g, 'o').replace(/\bthee\b/g, 'thee').trim();
}

// Edit distance, for spelling differences and OCR slips.
function distance(a, b) {
  if (a === b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}

/** How alike two titles are, 0 to 1. */
export function titleLikeness(a, b) {
  const x = normalTitle(a), y = normalTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const close = 1 - distance(x, y) / Math.max(x.length, y.length);
  // An index often shortens a long first line or drops a word or two from a
  // title ("Power in the Blood" for "There Is Power in the Blood").
  const shorter = x.length < y.length ? x : y, longer = x.length < y.length ? y : x;
  const starts = shorter.length >= 12 && (` ${longer} `).includes(` ${shorter} `) ? 0.92 : 0;
  return Math.max(close, starts);
}

/**
 * Index entries from lines of text, as typed, pasted or read off the index
 * pages: "Amazing Grace .... 209", "209 Amazing Grace", "209. Amazing Grace"
 * or "Amazing Grace, 209". Two columns read as one line give two entries.
 * Returns [{ number, title }] (number as written, e.g. "209" or "12a").
 */
export function parseIndex(text) {
  const entries = [];
  const lines = String(text).replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  for (const raw of lines) {
    // Dot leaders and tab stops between a title and its number.
    const line = raw.replace(/[.·…_\-–—]{2,}/g, ' ').replace(/\t+/g, ' ').replace(/\s+/g, ' ').trim();
    // Title then number, possibly several on a line.
    const after = [...line.matchAll(/([^\d][^\d]*?)[\s,.:]+(\d{1,4}[a-z]?)(?=\s|$)/gi)];
    const before = /^(\d{1,4}[a-z]?)[\s.):-]+(.*\D.*)$/i.exec(line);
    if (before && !after.length) {
      entries.push({ number: before[1], title: before[2].trim() });
      continue;
    }
    if (before && after.length && after[0].index > 0) {
      // "12 Title One 13 Title Two": numbers come first.
      for (const m of line.matchAll(/(\d{1,4}[a-z]?)[\s.):-]+([^\d]+)/gi)) entries.push({ number: m[1], title: m[2].trim() });
      continue;
    }
    for (const m of after) entries.push({ number: m[2], title: m[1].trim() });
  }
  return entries
    .map((e) => ({ number: e.number, title: e.title.replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '').replace(/\s+/g, ' ') }))
    .filter((e) => /[a-z]{2}/i.test(e.title));
}

/**
 * Each index entry with the library hymn it names (by title or first line),
 * or hymn: null when the library does not have it.
 * hymns: [{ id, title, firstLine }]. Returns [{ number, title, hymn }].
 */
export function matchIndex(entries, hymns, { least = 0.84 } = {}) {
  return entries.map((entry) => {
    let best = null, bestScore = least;
    for (const h of hymns) {
      const score = Math.max(titleLikeness(entry.title, h.title), titleLikeness(entry.title, h.firstLine || ''));
      if (score > bestScore) { best = h; bestScore = score; }
    }
    return { number: entry.number, title: entry.title, hymn: best ? best.id : null };
  });
}

/**
 * Hymns (and index entries the library does not have) that answer a search:
 * a number from the book, or words from a title or first line.
 * Returns [{ hymn (or null), number (or ''), title }], best first.
 */
export function findHymns(query, hymns, book = null, { limit = 50 } = {}) {
  const q = String(query).trim();
  const numbers = new Map(); // hymn id -> number in the book
  if (book) for (const e of book.entries) if (e.hymn && !numbers.has(e.hymn)) numbers.set(e.hymn, e.number);
  const row = (h, number) => ({ hymn: h, number: number ?? numbers.get(h.id) ?? '', title: h.title });
  if (!q) return hymns.slice(0, limit).map((h) => row(h));
  const byId = new Map(hymns.map((h) => [h.id, h]));
  if (/^\d{1,4}[a-z]?$/i.test(q)) {
    if (!book) return [];
    return book.entries.filter((e) => e.number.toLowerCase() === q.toLowerCase())
      .map((e) => (e.hymn && byId.has(e.hymn) ? row(byId.get(e.hymn), e.number) : { hymn: null, number: e.number, title: e.title }));
  }
  const words = normalTitle(q).split(' ').filter(Boolean);
  const scored = [];
  for (const h of hymns) {
    const text = normalTitle(`${h.title} ${h.firstLine || ''} ${h.writer || ''}`);
    if (!words.every((w) => text.includes(w))) continue;
    const title = normalTitle(h.title);
    // Songs in the church's own hymnal first, then titles that start with or hold the words.
    scored.push({ h, score: (numbers.has(h.id) ? 4 : 0) + (title.startsWith(words.join(' ')) ? 2 : 0) + (title.includes(words.join(' ')) ? 1 : 0) });
  }
  scored.sort((a, b) => b.score - a.score || a.h.title.localeCompare(b.h.title));
  const found = scored.slice(0, limit).map(({ h }) => row(h));
  // Songs in the book's index that the library does not have.
  if (book) {
    for (const e of book.entries) {
      if (e.hymn || found.length >= limit) continue;
      const text = normalTitle(e.title);
      if (words.every((w) => text.includes(w))) found.push({ hymn: null, number: e.number, title: e.title });
    }
  }
  return found;
}
