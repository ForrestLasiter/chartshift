// Security and data-safety rules for the main process, kept free of Electron
// imports so they can be unit-tested with plain Node.
const nodePath = require('path');

// --- where the app's own pages may live -------------------------------------

const APP_ORIGIN = 'app://chartshift';
const DEV_ORIGIN = 'http://localhost:5183';

/** True for URLs of the app's own UI (and the Vite server in development). */
function isTrustedUrl(url, dev = false) {
  let parsed;
  try { parsed = new URL(String(url)); } catch { return false; }
  if (parsed.protocol === 'app:') return parsed.host === 'chartshift';
  return dev && parsed.origin === DEV_ORIGIN;
}

// Production pages are served with this policy. Scripts and workers only from
// the app itself; 'wasm-unsafe-eval' lets the PDF and OCR engines compile
// their WebAssembly; inline style *attributes* are needed for page layout.
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data: blob:",
  "connect-src 'self' data: blob:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * The only permission the app ever grants: the microphone (sound only, never
 * the camera), and only to the app's own page. Used for recording an
 * instrument to work out its chords.
 */
function allowPermission({ permission, mediaTypes, url }, dev = false) {
  if (permission !== 'media' || !isTrustedUrl(url, dev)) return false;
  return Array.isArray(mediaTypes) && mediaTypes.length > 0 && mediaTypes.every((type) => type === 'audio');
}

/** True when `target` is `root` itself or somewhere beneath it. */
function isInside(root, target, pathLib = nodePath) {
  const relative = pathLib.relative(pathLib.resolve(root), pathLib.resolve(target));
  if (relative === '') return true;
  return !relative.startsWith('..' + pathLib.sep) && relative !== '..' && !pathLib.isAbsolute(relative);
}

/** Maps an app:// URL path to a file under `root`, or null if it would escape. */
function resolveAppPath(root, pathname, pathLib = nodePath) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\0')) return null;
  const target = pathLib.resolve(root, '.' + pathLib.sep + decoded.replace(/^[/\\]+/, ''));
  if (target === pathLib.resolve(root) || !isInside(root, target, pathLib)) return null;
  return target;
}

// --- one thing at a time ----------------------------------------------------

/** Runs async tasks strictly one after another, in the order they were added. */
function createSerialQueue() {
  let chain = Promise.resolve();
  return (task) => {
    const run = chain.then(task, task);
    chain = run.catch(() => {});
    return run;
  };
}

// --- library files ----------------------------------------------------------

const SONG_EXT = '.chartshift';
const SETLIST_EXT = '.setlist.json';
const MB = 1024 * 1024;

const LIMITS = {
  songBytes: 300 * MB,        // one .chartshift file
  setlistBytes: 1 * MB,
  setlistSongs: 500,
  zipBytes: 1024 * MB,        // an exported library
  zipEntries: 2000,
  zipTotalBytes: 2048 * MB,   // everything in it, unpacked
  printPages: 500,
  printImageBytes: 80 * MB,
  exportBytes: 1024 * MB,     // a PDF or ChordPro file being saved
  audioBytes: 200 * MB,       // a recording chosen for chord detection
};

// Names come from the renderer or from zip files; never let one escape the library folder.
function safeName(name) {
  const clean = String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\.+$/, '').trim().slice(0, 120);
  if (!clean) throw new Error('That name cannot be used.');
  return clean;
}

/** Parses and sanity-checks a setlist file. Throws a readable error if it is not one. */
function parseSetlist(text) {
  if (text.length > LIMITS.setlistBytes) throw new Error('The setlist file is too large.');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('The setlist file is damaged.'); }
  if (!data || !Array.isArray(data.songs)) throw new Error('The setlist file is damaged.');
  if (data.songs.length > LIMITS.setlistSongs) throw new Error('The setlist has too many songs.');
  return { songs: data.songs.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.slice(0, 120)) };
}

/**
 * Decides which entries of an imported library zip may be unpacked.
 * entries: [{ name, dir, size }] where size is the unpacked size.
 * Throws when the archive as a whole is unreasonable; otherwise returns
 * { accept: [{ entry, file }], rejected: [{ name, reason }] } with `file`
 * being the safe flat file name to write inside the library folder.
 */
function planZipImport(entries, limits = LIMITS) {
  if (entries.length > limits.zipEntries) throw new Error(`That file holds more than ${limits.zipEntries} items, so it is not a ChartShift library.`);
  const accept = [], rejected = [];
  const seen = new Set();
  let total = 0;
  for (const entry of entries) {
    if (entry.dir) continue;
    // Zip-slip guard: only the last path segment is ever used, then cleaned.
    const base = String(entry.name).split(/[/\\]/).pop();
    const ext = base.endsWith(SONG_EXT) ? SONG_EXT : base.endsWith(SETLIST_EXT) ? SETLIST_EXT : null;
    if (!ext) continue;
    let file;
    try { file = safeName(base.slice(0, -ext.length)) + ext; } catch { rejected.push({ name: base, reason: 'its name cannot be used' }); continue; }
    const size = Number(entry.size);
    const cap = ext === SONG_EXT ? limits.songBytes : limits.setlistBytes;
    if (!Number.isFinite(size) || size < 0 || size > cap) { rejected.push({ name: base, reason: 'it is too large' }); continue; }
    if (seen.has(file.toLowerCase())) { rejected.push({ name: base, reason: 'the archive lists it twice' }); continue; }
    total += size;
    if (total > limits.zipTotalBytes) throw new Error('That library is too large to import in one go.');
    seen.add(file.toLowerCase());
    accept.push({ entry, file });
  }
  return { accept, rejected };
}

// --- saving over a song that may have changed elsewhere ----------------------

/**
 * What to do when saving `name`. `expect` is the version (content hash) the
 * editor last read or wrote; `current` is what is in the folder now.
 *   'write'   – nothing in the way
 *   'changed' – someone else (another PC, via a synced folder) saved a
 *               different version since this editor opened it
 *   'exists'  – a different song already has this name
 */
function decideWrite({ current, expect }) {
  if (current == null) return 'write';
  if (expect != null) return current === expect ? 'write' : 'changed';
  return 'exists';
}

const two = (n) => String(n).padStart(2, '0');

/**
 * "Song (conflict copy 2026-10-03 14.05.09)" – a name for a preserved version.
 * The time only has one-second precision, so on its own it is not unique:
 * `n` (2, 3, …) adds "#n". Callers must still create the file exclusively and
 * move on to the next `n` if the name turns out to be taken.
 */
function copyName(name, label, date = new Date(), n = 1) {
  const stamp = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}.${two(date.getMinutes())}.${two(date.getSeconds())}`;
  const suffix = ` (${label} ${stamp}${n > 1 ? ` #${n}` : ''})`;
  return safeName(name).slice(0, 120 - suffix.length).trimEnd() + suffix;
}

// --- printing ---------------------------------------------------------------

/** Checks the pages sent for printing and normalises their sizes (inches). */
function checkPrintPages(pages, limits = LIMITS) {
  if (!Array.isArray(pages) || !pages.length) throw new Error('There is nothing to print.');
  if (pages.length > limits.printPages) throw new Error(`Printing is limited to ${limits.printPages} pages at a time.`);
  return pages.map((page) => {
    const widthIn = Number(page.widthIn), heightIn = Number(page.heightIn);
    if (!(widthIn >= 1 && widthIn <= 60 && heightIn >= 1 && heightIn <= 60)) throw new Error('A page has a size that cannot be printed.');
    if (!page.png || page.png.byteLength > limits.printImageBytes) throw new Error('A page image is too large to print.');
    return { widthIn: Math.round(widthIn * 1000) / 1000, heightIn: Math.round(heightIn * 1000) / 1000 };
  });
}

/**
 * The HTML handed to the print dialog. Every distinct sheet size gets its own
 * named @page rule, so portrait and landscape (or Letter and A4) pages can sit
 * in one job. `uniform` is set when all sheets are the same size, which lets
 * the caller tell the printer the exact paper size.
 * sizes: [{ widthIn, heightIn }], one per page, in order. Images are page-N.png.
 */
function buildPrintHtml(sizes) {
  const rules = new Map();
  const blocks = sizes.map((size, i) => {
    const key = `${size.widthIn}x${size.heightIn}`;
    if (!rules.has(key)) rules.set(key, { name: `sheet${rules.size}`, ...size });
    const { name } = rules.get(key);
    return `<div class="page ${name}"><img src="page-${i}.png" alt=""></div>`;
  });
  const css = [...rules.values()].map((r) =>
    `@page ${r.name} { size: ${r.widthIn}in ${r.heightIn}in; margin: 0; }\n` +
    `.${r.name} { page: ${r.name}; width: ${r.widthIn}in; height: ${r.heightIn}in; }`).join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file:; style-src 'unsafe-inline'">
<title>ChartShift</title><style>
@page { margin: 0; }
html, body { margin: 0; padding: 0; }
.page { break-after: page; overflow: hidden; }
.page:last-child { break-after: auto; }
img { width: 100%; height: 100%; display: block; object-fit: contain; }
${css}
</style></head><body>${blocks.join('')}</body></html>`;
  return { html, uniform: rules.size === 1 ? { ...sizes[0] } : null };
}

module.exports = {
  APP_ORIGIN, DEV_ORIGIN, CONTENT_SECURITY_POLICY, LIMITS, SONG_EXT, SETLIST_EXT,
  isTrustedUrl, allowPermission, isInside, resolveAppPath, createSerialQueue,
  safeName, parseSetlist, planZipImport, decideWrite, copyName,
  checkPrintPages, buildPrintHtml,
};
