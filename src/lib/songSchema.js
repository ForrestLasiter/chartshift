// Validation for song files. A .chartshift file can come from anywhere (a
// download, a shared drive, an imported library), so nothing in it is trusted:
// the structure is checked, sizes are bounded, and only known fields survive.
// Pure functions, no DOM.

const MB = 1024 * 1024;

export const LIMITS = {
  fileBytes: 300 * MB,       // any file opened
  imageBytes: 100 * MB,
  chordProBytes: 2 * MB,
  pdfPages: 100,
  zipEntries: 600,           // files inside one song
  jsonBytes: 40 * MB,
  atlasBytes: 80 * MB,       // one sprite sheet, as stored
  totalBytes: 600 * MB,      // a song unpacked
  atlases: 400,
  atlasSide: 16384,
  atlasPixels: 64 * 1000 * 1000,
  pages: 200,
  pageSide: 3600,            // points (50 inches)
  piecesPerPage: 60000,
  pieces: 300000,
  sections: 500,
  textLength: 20000,
  songText: 200000,       // the typed words of a written song
  drafts: 30,
};

const FORMAT = 'chartshift-song';
export const VERSION = 1;

const KNOWN_FONTS = [
  'Arial, Helvetica, sans-serif',
  '"Courier New", Courier, monospace',
  'Consolas, "Courier New", monospace',
  '"Times New Roman", Times, serif',
  'Georgia, serif',
  'Verdana, Geneva, sans-serif',
];

class SongError extends Error {}
const fail = (message) => { throw new SongError(message); };

const num = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const id = (v) => Number.isInteger(v) && v >= 0 && v <= 2 ** 40;
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined);

function cleanPiece(p, atlasCount, where) {
  if (!p || typeof p !== 'object') fail(`${where} is damaged.`);
  if (!id(p.id)) fail(`${where} has no valid id.`);
  if (!num(p.x, -1e5, 1e5) || !num(p.y, -1e5, 1e5) || !num(p.w, 0, 1e5) || !num(p.h, 0, 1e5)) fail(`${where} has an impossible position or size.`);
  const out = { id: p.id, kind: p.kind, x: p.x, y: p.y, w: p.w, h: p.h };
  if (id(p.section)) out.section = p.section;
  if (p.kind === 'clip') {
    if (!Number.isInteger(p.atlas) || p.atlas < 0 || p.atlas >= atlasCount) fail(`${where} points at a picture that is not in the file.`);
    if (!num(p.sx, 0, LIMITS.atlasSide) || !num(p.sy, 0, LIMITS.atlasSide) || !num(p.sw, 1, LIMITS.atlasSide) || !num(p.sh, 1, LIMITS.atlasSide)) fail(`${where} has an impossible picture area.`);
    if (!id(p.word) || !id(p.line) || !id(p.block)) fail(`${where} is missing its grouping.`);
    Object.assign(out, { atlas: p.atlas, sx: p.sx, sy: p.sy, sw: p.sw, sh: p.sh, word: p.word, line: p.line, block: p.block });
    if (p.frame === true) out.frame = true;
    if (p.contained === true) out.contained = true;
    if (typeof p.t === 'string' && id(p.tok)) { out.t = p.t.slice(0, 200); out.tok = p.tok; }
    if (typeof p.chord === 'string' && out.tok != null) out.chord = p.chord.slice(0, 40);
    if (p.ff === 'mono' || p.ff === 'serif' || p.ff === 'sans') out.ff = p.ff;
    if (p.bold === true) out.bold = true;
  } else if (p.kind === 'text') {
    if (typeof p.text !== 'string') fail(`${where} has no text.`);
    if (!num(p.size, 1, 2000)) fail(`${where} has an impossible text size.`);
    Object.assign(out, {
      text: p.text.slice(0, LIMITS.textLength),
      // Unknown fonts and colours fall back to safe defaults instead of being trusted.
      font: KNOWN_FONTS.includes(p.font) ? p.font : KNOWN_FONTS[0],
      size: p.size,
      bold: p.bold === true,
      italic: p.italic === true,
      color: typeof p.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : '#000000',
    });
    if (p.chord === true) out.chord = true;
  } else if (p.kind === 'diagram') {
    if (typeof p.chord !== 'string' || !(p.instrument === 'guitar' || p.instrument === 'ukulele')) fail(`${where} is not a valid chord diagram.`);
    Object.assign(out, { chord: p.chord.slice(0, 24), instrument: p.instrument });
  } else {
    fail(`${where} is of an unknown kind.`);
  }
  return out;
}

const META_FIELDS = ['title', 'artist', 'key', 'tempo', 'time', 'capo'];
const cleanMeta = (meta) => Object.fromEntries(META_FIELDS.map((name) => [name, typeof meta?.[name] === 'string' ? meta[name].slice(0, 120) : '']));

// The typed part of a written song: its facts, words, and saved drafts.
function cleanWrite(write) {
  if (write == null) return null;
  if (typeof write !== 'object' || typeof write.text !== 'string') fail('The written part of this song is damaged.');
  if (write.text.length > LIMITS.songText) fail('The words of this song are too long to open.');
  const drafts = Array.isArray(write.drafts) ? write.drafts : [];
  if (drafts.length > LIMITS.drafts) fail('This song has too many drafts.');
  return {
    meta: cleanMeta(write.meta),
    text: write.text,
    diagrams: write.diagrams === 'guitar' || write.diagrams === 'ukulele' ? write.diagrams : null,
    columns: write.columns === 2 ? 2 : 1,
    drafts: drafts.filter((d) => d && typeof d.text === 'string' && d.text.length <= LIMITS.songText).map((d) => ({
      name: (str(d.name, 80) || 'Draft'), saved: str(d.saved, 40) || '', text: d.text, meta: cleanMeta(d.meta),
    })),
  };
}

/**
 * Checks the parsed song.json and returns a cleaned copy:
 * { pages, atlasCount, ids, write }. Throws an Error with a readable message.
 */
export function validateSong(song) {
  try {
    if (!song || typeof song !== 'object' || song.format !== FORMAT) fail('This file is not a ChartShift song.');
    if (!Number.isInteger(song.version) || song.version < 1) fail('This file is not a ChartShift song.');
    if (song.version > VERSION) fail('This song was saved by a newer version of ChartShift. Update ChartShift to open it.');
    const atlasCount = song.atlasCount;
    if (!Number.isInteger(atlasCount) || atlasCount < 0 || atlasCount > LIMITS.atlases) fail('This song has an impossible number of pictures.');
    if (!Array.isArray(song.pages) || !song.pages.length) fail('This song has no pages.');
    if (song.pages.length > LIMITS.pages) fail(`This song has more than ${LIMITS.pages} pages.`);

    let total = 0, maxPiece = 0, maxGroup = 0, maxPage = 0;
    const seenPieces = new Set(), seenPages = new Set();
    const pages = song.pages.map((page, i) => {
      const where = `Page ${i + 1}`;
      if (!page || typeof page !== 'object') fail(`${where} is damaged.`);
      if (!id(page.id) || seenPages.has(page.id)) fail(`${where} has no valid id.`);
      seenPages.add(page.id);
      if (!num(page.w, 36, LIMITS.pageSide) || !num(page.h, 36, LIMITS.pageSide)) fail(`${where} has an impossible size.`);
      if (!Array.isArray(page.pieces)) fail(`${where} is damaged.`);
      if (page.pieces.length > LIMITS.piecesPerPage) fail(`${where} has too many pieces.`);
      total += page.pieces.length;
      if (total > LIMITS.pieces) fail('This song has too many pieces.');
      const pieces = page.pieces.map((p, n) => {
        const piece = cleanPiece(p, atlasCount, `${where}, piece ${n + 1}`);
        if (seenPieces.has(piece.id)) fail(`${where} repeats a piece id.`);
        seenPieces.add(piece.id);
        maxPiece = Math.max(maxPiece, piece.id);
        maxGroup = Math.max(maxGroup, piece.word || 0, piece.line || 0, piece.block || 0, piece.tok || 0, piece.section || 0);
        return piece;
      });
      const rawSections = Array.isArray(page.sections) ? page.sections : [];
      if (rawSections.length > LIMITS.sections) fail(`${where} has too many sections.`);
      const sections = rawSections
        .filter((s) => s && id(s.id) && typeof s.label === 'string')
        .map((s) => { maxGroup = Math.max(maxGroup, s.id); return { id: s.id, label: str(s.label, 80) }; });
      maxPage = Math.max(maxPage, page.id);
      return { id: page.id, w: page.w, h: page.h, pieces, sections };
    });
    // Counters are rebuilt from the content, so new ids can never collide.
    return { pages, atlasCount, ids: { piece: maxPiece + 1, group: maxGroup + 1, page: maxPage + 1 }, write: cleanWrite(song.write) };
  } catch (error) {
    if (error instanceof SongError) throw new Error(error.message);
    throw new Error('This song file is damaged and cannot be opened.');
  }
}

/** Width and height declared in a PNG's header, without decoding it. */
export function pngSize(bytes) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!bytes || bytes.length < 24 || signature.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(12) !== 0x49484452) return null; // "IHDR"
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Throws unless the PNG is a plausible sprite sheet. */
export function checkAtlasPng(bytes) {
  const size = pngSize(bytes);
  if (!size) throw new Error('A picture inside this song is damaged.');
  if (!size.width || !size.height || size.width > LIMITS.atlasSide || size.height > LIMITS.atlasSide || size.width * size.height > LIMITS.atlasPixels) {
    throw new Error('A picture inside this song is too large to open safely.');
  }
  return size;
}

/** Checks the unpacked sizes of a song zip's entries before anything is inflated. */
export function checkSongEntries(entries) {
  if (entries.length > LIMITS.zipEntries) throw new Error('This song file holds too many items to be genuine.');
  let total = 0;
  for (const entry of entries) {
    const cap = entry.name === 'song.json' ? LIMITS.jsonBytes : LIMITS.atlasBytes;
    if (!(entry.size >= 0) || entry.size > cap) throw new Error('This song file contains an item that is too large.');
    total += entry.size;
    if (total > LIMITS.totalBytes) throw new Error('This song file is too large to open.');
  }
}
