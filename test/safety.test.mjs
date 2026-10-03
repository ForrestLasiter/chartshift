// Regression tests for the security and data-safety audit fixes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import safety from '../electron/safety.cjs';
import { createRecoveryQueue } from '../src/lib/recoveryQueue.js';
import { LIMITS, checkAtlasPng, checkSongEntries, pngSize, validateSong } from '../src/lib/songSchema.js';
import { PAPERS, isMixed, nearestPaper, pageSizes, planPrint } from '../src/lib/printPlan.js';

// --- 1. Electron: trusted origins --------------------------------------------

test('only the app origin (and the dev server in dev) is trusted', () => {
  assert.ok(safety.isTrustedUrl('app://chartshift/index.html'));
  assert.ok(safety.isTrustedUrl('app://chartshift/index.html?sample'));
  for (const url of ['https://example.com/', 'app://evil/index.html', 'app://chartshift.evil.com/', 'file:///C:/x.html',
    'http://localhost:5183/', 'javascript:alert(1)', 'about:blank', 'data:text/html,hi', '', null, 'not a url']) {
    assert.ok(!safety.isTrustedUrl(url), String(url));
  }
  assert.ok(safety.isTrustedUrl('http://localhost:5183/src/main.jsx', true));
  assert.ok(!safety.isTrustedUrl('http://localhost:5184/', true));
  assert.ok(!safety.isTrustedUrl('http://localhost.evil.com:5183/', true));
});

test('the content security policy forbids remote and inline script', () => {
  const csp = safety.CONTENT_SECURITY_POLICY;
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self' 'wasm-unsafe-eval'(;|$)/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-eval'/);
  assert.doesNotMatch(csp, /https?:/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'none'/);
});

// --- 3. Protocol path containment --------------------------------------------

for (const [label, lib, root, inside, sibling, other] of [
  ['windows', path.win32, 'C:\\Apps\\ChartShift\\dist', 'C:\\Apps\\ChartShift\\dist\\assets\\a.js', 'C:\\Apps\\ChartShift\\dist-evil\\a.js', 'D:\\dist\\a.js'],
  ['posix', path.posix, '/opt/chartshift/dist', '/opt/chartshift/dist/assets/a.js', '/opt/chartshift/dist-evil/a.js', '/etc/passwd'],
]) {
  test(`path containment is separator-aware (${label})`, () => {
    assert.ok(safety.isInside(root, inside, lib));
    assert.ok(safety.isInside(root, root, lib));
    assert.ok(!safety.isInside(root, sibling, lib), 'a sibling sharing the prefix is outside');
    assert.ok(!safety.isInside(root, lib.dirname(root), lib), 'the parent is outside');
    assert.ok(!safety.isInside(root, other, lib));
    assert.ok(!safety.isInside(root, lib.join(root, '..', 'secret.txt'), lib));
  });

  test(`app:// paths cannot escape the app folder (${label})`, () => {
    const ok = safety.resolveAppPath(root, '/assets/index.js', lib);
    assert.equal(ok, lib.join(root, 'assets', 'index.js'));
    for (const attack of ['/../package.json', '/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/secret', '/assets/../../x', '/..\\..\\x',
      '/%5c..%5c..%5cx', '//etc/passwd', '/%00', '/a%00.js', '/', '', '/%', '/../dist-evil/a.js']) {
      const resolved = safety.resolveAppPath(root, attack, lib);
      assert.ok(resolved === null || safety.isInside(root, resolved, lib) && resolved !== lib.resolve(root), attack);
    }
    assert.equal(safety.resolveAppPath(root, '/..%2fdist-evil%2fa.js', lib), null);
    assert.equal(safety.resolveAppPath(root, '/%E0%A4%A', lib), null, 'malformed escapes are refused');
  });
}

test('windows: drive-letter and case tricks stay inside or are refused', () => {
  const root = 'C:\\Apps\\ChartShift\\dist';
  const r = safety.resolveAppPath(root, '/C:/Windows/win.ini', path.win32);
  assert.ok(r === null || safety.isInside(root, r, path.win32));
  assert.ok(safety.isInside(root, 'c:\\apps\\chartshift\\DIST\\x.js', path.win32), 'windows paths compare case-insensitively');
});

// --- 2. Autosave race ----------------------------------------------------------

function fakeBackend() {
  const log = [];
  const backend = {
    stored: null,
    save: async (meta, data) => { log.push(`save:${data}`); backend.stored = data; },
    clear: async () => { log.push('clear'); backend.stored = null; },
  };
  return { backend, log };
}
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

test('an autosave still being built cannot recreate recovery data after a clear', async () => {
  const { backend, log } = fakeBackend();
  const queue = createRecoveryQueue(backend);
  const build = deferred();
  const saving = queue.save(() => build.promise);          // autosave starts packing the song…
  await Promise.resolve();
  const clearing = queue.clear();                           // …the user saves the song for real…
  build.resolve({ meta: {}, data: 'stale' });               // …then the packing finishes.
  assert.equal(await saving, false, 'the stale autosave is dropped');
  await clearing;
  assert.equal(backend.stored, null);
  assert.deepEqual(log, ['clear']);
});

test('an autosave already writing is followed by the clear, never the other way round', async () => {
  const { backend, log } = fakeBackend();
  const gate = deferred();
  const slowSave = backend.save;
  backend.save = async (meta, data) => { await gate.promise; return slowSave(meta, data); };
  const queue = createRecoveryQueue(backend);
  const saving = queue.save(async () => ({ meta: {}, data: 'old' }));
  await new Promise((r) => setTimeout(r, 5));               // the write is now in flight
  const clearing = queue.clear();
  gate.resolve();
  await Promise.all([saving, clearing]);
  assert.equal(backend.stored, null);
  assert.deepEqual(log, ['save:old', 'clear']);
});

test('work done after a clear is autosaved again, and a failed save does not jam the queue', async () => {
  const { backend } = fakeBackend();
  const queue = createRecoveryQueue(backend);
  await queue.clear();
  await assert.rejects(queue.save(async () => { throw new Error('disk full'); }));
  assert.equal(await queue.save(async () => ({ meta: {}, data: 'new' })), true);
  assert.equal(backend.stored, 'new');
});

test('serial queue runs tasks one at a time in order', async () => {
  const run = safety.createSerialQueue();
  const order = [];
  const slow = run(async () => { await new Promise((r) => setTimeout(r, 20)); order.push('a'); });
  const fast = run(async () => { order.push('b'); });
  const failing = run(async () => { throw new Error('x'); });
  const after = run(async () => { order.push('c'); });
  await assert.rejects(failing);
  await Promise.all([slow, fast, after]);
  assert.deepEqual(order, ['a', 'b', 'c']);
});

// --- 4. Untrusted files ----------------------------------------------------------

const clip = (over = {}) => ({ id: 1, kind: 'clip', x: 10, y: 10, w: 5, h: 8, atlas: 0, sx: 1, sy: 1, sw: 20, sh: 30, word: 1, line: 1, block: 1, ...over });
const text = (over = {}) => ({ id: 2, kind: 'text', x: 10, y: 40, w: 30, h: 14, text: 'Em', font: 'Arial, Helvetica, sans-serif', size: 12, bold: false, italic: false, color: '#000000', ...over });
const song = (over = {}) => ({ format: 'chartshift-song', version: 1, atlasCount: 1, ids: { piece: 3, group: 2, page: 2 }, pages: [{ id: 1, w: 612, h: 792, pieces: [clip(), text()], sections: [] }], ...over });

test('a valid song passes and keeps its content', () => {
  const out = validateSong(song());
  assert.equal(out.pages[0].pieces.length, 2);
  assert.deepEqual(out.pages[0].pieces[0], clip());
  assert.deepEqual(out.ids, { piece: 3, group: 2, page: 2 });
});

test('malformed songs are refused with a readable message', () => {
  const bad = [
    [null, /not a ChartShift song/],
    [{}, /not a ChartShift song/],
    [song({ format: 'other' }), /not a ChartShift song/],
    [song({ version: 99 }), /newer version/],
    [song({ pages: [] }), /no pages/],
    [song({ pages: 'x' }), /no pages/],
    [song({ pages: Array(LIMITS.pages + 1).fill({ id: 1, w: 612, h: 792, pieces: [] }) }), /more than/],
    [song({ atlasCount: 1e9 }), /impossible number of pictures/],
    [song({ pages: [{ id: 1, w: 1e9, h: 792, pieces: [] }] }), /impossible size/],
    [song({ pages: [{ id: 1, w: 612, h: 792, pieces: [clip({ atlas: 5 })] }] }), /not in the file/],
    [song({ pages: [{ id: 1, w: 612, h: 792, pieces: [clip({ x: 'NaN' })] }] }), /impossible position/],
    [song({ pages: [{ id: 1, w: 612, h: 792, pieces: [clip({ w: Infinity })] }] }), /impossible position/],
    [song({ pages: [{ id: 1, w: 612, h: 792, pieces: [clip({ sw: 1e7 })] }] }), /impossible picture area/],
    [song({ pages: [{ id: 1, w: 612, h: 792, pieces: [clip(), clip()] }] }), /repeats a piece id/],
    [song({ pages: [{ id: 1, w: 612, h: 792, pieces: [{ id: 9, kind: 'script', x: 0, y: 0, w: 1, h: 1 }] }] }), /unknown kind/],
    [song({ pages: [{ id: 1, w: 612, h: 792, pieces: [text({ size: -4 })] }] }), /text size/],
    [song({ pages: [{ id: 1, w: 612, h: 792, pieces: { length: 1e9 } }] }), /damaged/],
  ];
  for (const [input, pattern] of bad) assert.throws(() => validateSong(input), pattern);
});

test('too many pieces are refused before they are processed', () => {
  const pieces = Array.from({ length: LIMITS.piecesPerPage + 1 }, (_, i) => clip({ id: i }));
  assert.throws(() => validateSong(song({ pages: [{ id: 1, w: 612, h: 792, pieces }] })), /too many pieces/);
});

test('unknown fields, unsafe fonts and colours do not survive validation', () => {
  const sneaky = JSON.parse(JSON.stringify(song({
    ids: { piece: 1, group: 1, page: 1 },
    pages: [{ id: 7, w: 612, h: 792, extra: 'x', sections: [{ id: 4, label: 'V'.repeat(500), evil: true }, 'junk'],
      pieces: [clip({ onload: 'alert(1)', section: 4 }), text({ font: 'x; } body { display:none', color: 'url(http://evil)', text: 'ok', extra: {} })] }],
  })));
  sneaky.pages[0].pieces[0].__proto__ = { polluted: true };
  const out = validateSong(sneaky);
  const [c, t] = out.pages[0].pieces;
  assert.equal(c.onload, undefined);
  assert.equal(c.polluted, undefined);
  assert.equal(t.font, 'Arial, Helvetica, sans-serif');
  assert.equal(t.color, '#000000');
  assert.equal(t.extra, undefined);
  assert.equal(out.pages[0].extra, undefined);
  assert.equal(out.pages[0].sections.length, 1);
  assert.equal(out.pages[0].sections[0].label.length, 80);
  assert.deepEqual(out.ids, { piece: 3, group: 5, page: 8 }, 'id counters are rebuilt from the content, not trusted');
});

function pngHeader(width, height) {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

test('picture dimensions are checked from the header, before decoding', () => {
  assert.deepEqual(pngSize(pngHeader(2550, 142)), { width: 2550, height: 142 });
  assert.equal(pngSize(new Uint8Array([1, 2, 3])), null);
  assert.deepEqual(checkAtlasPng(pngHeader(2550, 8192)), { width: 2550, height: 8192 });
  assert.throws(() => checkAtlasPng(pngHeader(60000, 60000)), /too large/);
  assert.throws(() => checkAtlasPng(pngHeader(16000, 16000)), /too large/, 'pixel count is limited as well as each side');
  assert.throws(() => checkAtlasPng(pngHeader(0, 10)), /too large/);
  assert.throws(() => checkAtlasPng(new Uint8Array(40)), /damaged/);
});

test('song archives with too many or oversized entries are refused', () => {
  checkSongEntries([{ name: 'song.json', size: 1000 }, { name: 'atlas-0.png', size: 5e6 }]);
  assert.throws(() => checkSongEntries(Array(LIMITS.zipEntries + 1).fill({ name: 'a', size: 1 })), /too many items/);
  assert.throws(() => checkSongEntries([{ name: 'song.json', size: LIMITS.jsonBytes + 1 }]), /too large/);
  assert.throws(() => checkSongEntries([{ name: 'atlas-0.png', size: LIMITS.atlasBytes + 1 }]), /too large/);
  assert.throws(() => checkSongEntries(Array(10).fill({ name: 'atlas.png', size: LIMITS.atlasBytes })), /too large to open/);
});

test('library import: zip-slip names are flattened, junk and oversize are refused', () => {
  const entries = [
    { name: 'Good Song.chartshift', size: 1000 },
    { name: '../../Windows/evil.chartshift', size: 1000 },
    { name: 'sub\\..\\..\\escape.setlist.json', size: 100 },
    { name: 'C:/Users/x/AppData/startup.chartshift', size: 10 },
    { name: 'folder/', dir: true, size: 0 },
    { name: 'readme.txt', size: 10 },
    { name: 'malware.exe', size: 10 },
    { name: 'Huge.chartshift', size: safety.LIMITS.songBytes + 1 },
    { name: 'big.setlist.json', size: safety.LIMITS.setlistBytes + 1 },
    { name: 'a/Good Song.chartshift', size: 5 },
    { name: '....chartshift', size: 5 },
  ];
  const { accept, rejected } = safety.planZipImport(entries);
  assert.deepEqual(accept.map((a) => a.file), ['Good Song.chartshift', 'evil.chartshift', 'escape.setlist.json', 'startup.chartshift']);
  for (const { file } of accept) assert.ok(!/[\\/]|\.\./.test(file), file);
  assert.deepEqual(rejected.map((r) => r.reason), ['it is too large', 'it is too large', 'the archive lists it twice', 'its name cannot be used']);
  assert.throws(() => safety.planZipImport(Array(safety.LIMITS.zipEntries + 1).fill({ name: 'a.chartshift', size: 1 })), /more than/);
  const many = Array.from({ length: 10 }, (_, i) => ({ name: `s${i}.chartshift`, size: safety.LIMITS.songBytes }));
  assert.throws(() => safety.planZipImport(many), /too large to import/);
});

test('setlists are parsed defensively', () => {
  assert.deepEqual(safety.parseSetlist('{"songs":["A","",5,null,"B"]}'), { songs: ['A', 'B'] });
  assert.throws(() => safety.parseSetlist('{"songs":'), /damaged/);
  assert.throws(() => safety.parseSetlist('[]'), /damaged/);
  assert.throws(() => safety.parseSetlist(JSON.stringify({ songs: Array(safety.LIMITS.setlistSongs + 1).fill('x') })), /too many/);
  assert.throws(() => safety.parseSetlist('x'.repeat(safety.LIMITS.setlistBytes + 1)), /too large/);
});

test('names cannot leave the library folder', () => {
  assert.equal(safety.safeName('..\\..\\evil'), '....evil');
  assert.equal(safety.safeName('a/b:c*?'), 'abc');
  assert.equal(safety.safeName('Song...'), 'Song');
  assert.throws(() => safety.safeName('..'));
  assert.throws(() => safety.safeName('///'));
  assert.ok(!/[\\/]/.test(safety.safeName('x/../../y')));
});

// --- 5. Sync conflicts -------------------------------------------------------------

test('saving detects a version this editor has not seen', () => {
  assert.equal(safety.decideWrite({ current: null, expect: null }), 'write', 'new song');
  assert.equal(safety.decideWrite({ current: null, expect: 'v1' }), 'write', 'deleted elsewhere: saving restores it');
  assert.equal(safety.decideWrite({ current: 'v1', expect: 'v1' }), 'write', 'unchanged since opened');
  assert.equal(safety.decideWrite({ current: 'v2', expect: 'v1' }), 'changed', 'changed on another PC');
  assert.equal(safety.decideWrite({ current: 'v1', expect: null }), 'exists', 'a different song has the name');
});

test('preserved copies get a safe, dated name', () => {
  const name = safety.copyName('Amazing Grace', 'conflict copy', new Date(2026, 9, 3, 14, 5, 9));
  assert.equal(name, 'Amazing Grace (conflict copy 2026-10-03 14.05.09)');
  assert.ok(safety.copyName('x'.repeat(200), 'my copy').length <= 120);
  assert.equal(safety.safeName(name), name, 'the name is valid as a file name');
});

// --- 6. Printing mixed page sizes ----------------------------------------------------

const letter = { w: 612, h: 792 }, wide = { w: 792, h: 612 }, a5 = { w: 420, h: 595 };

test('mixed page sizes and orientations are detected', () => {
  assert.equal(isMixed([letter, letter, { w: 612.4, h: 791.8 }]), false, 'rounding differences are not a mix');
  assert.equal(isMixed([letter, wide]), true, 'orientation counts');
  assert.deepEqual(pageSizes([letter, wide, letter, a5]).map((s) => s.count), [2, 1, 1]);
  assert.equal(nearestPaper([{ w: 595, h: 842 }]).id, 'a4');
  assert.equal(nearestPaper([wide]).id, 'letter');
});

test('"own size" keeps each page on a sheet of its own size', () => {
  assert.deepEqual(planPrint([letter, wide, a5], { mode: 'own' }), [
    { w: 612, h: 792, rotate: false, scale: 1 },
    { w: 792, h: 612, rotate: false, scale: 1 },
    { w: 420, h: 595, rotate: false, scale: 1 },
  ]);
});

test('"one paper size" puts every page on the same sheet, turning landscape pages', () => {
  const plan = planPrint([letter, wide, a5, { w: 1224, h: 792 }], { mode: 'paper', paper: PAPERS[0] });
  assert.ok(plan.every((p) => p.w === 612 && p.h === 792), 'one sheet size for the whole job');
  assert.deepEqual(plan.map((p) => p.rotate), [false, true, false, true]);
  assert.equal(plan[0].scale, 1);
  assert.equal(plan[1].scale, 1, 'a landscape letter page fills the turned sheet');
  assert.ok(plan[2].scale > 1 && plan[2].scale <= 792 / 595 + 1e-9, 'smaller pages are enlarged to fit, never cropped');
  assert.ok(Math.abs(plan[3].scale - 792 / 1224) < 1e-9, 'larger pages shrink to fit');
});

test('print HTML gives each sheet size its own @page rule', () => {
  const sizes = [{ widthIn: 8.5, heightIn: 11 }, { widthIn: 11, heightIn: 8.5 }, { widthIn: 8.5, heightIn: 11 }, { widthIn: 5.833, heightIn: 8.264 }];
  const { html, uniform } = safety.buildPrintHtml(sizes);
  assert.equal(uniform, null);
  assert.match(html, /@page sheet0 \{ size: 8\.5in 11in; margin: 0; \}/);
  assert.match(html, /@page sheet1 \{ size: 11in 8\.5in; margin: 0; \}/);
  assert.match(html, /@page sheet2 \{ size: 5\.833in 8\.264in; margin: 0; \}/);
  assert.equal((html.match(/@page sheet/g) || []).length, 3, 'one rule per distinct size');
  assert.deepEqual([...html.matchAll(/class="page (sheet\d)"><img src="(page-\d\.png)"/g)].map((m) => [m[1], m[2]]),
    [['sheet0', 'page-0.png'], ['sheet1', 'page-1.png'], ['sheet0', 'page-2.png'], ['sheet2', 'page-3.png']]);
  assert.match(html, /object-fit: contain/);
  assert.match(html, /Content-Security-Policy/);
  assert.deepEqual(safety.buildPrintHtml([sizes[0], sizes[2]]).uniform, { widthIn: 8.5, heightIn: 11 });
});

test('print requests are bounded and validated', () => {
  const png = new Uint8Array(10);
  assert.deepEqual(safety.checkPrintPages([{ png, widthIn: 8.5, heightIn: 11.00004 }]), [{ widthIn: 8.5, heightIn: 11 }]);
  assert.throws(() => safety.checkPrintPages([]), /nothing to print/);
  assert.throws(() => safety.checkPrintPages('x'), /nothing to print/);
  assert.throws(() => safety.checkPrintPages([{ png, widthIn: '8.5in; } body{}', heightIn: 11 }]), /cannot be printed/);
  assert.throws(() => safety.checkPrintPages([{ png, widthIn: 500, heightIn: 11 }]), /cannot be printed/);
  assert.throws(() => safety.checkPrintPages([{ widthIn: 8.5, heightIn: 11 }]), /too large/);
  assert.throws(() => safety.checkPrintPages(Array(safety.LIMITS.printPages + 1).fill({ png, widthIn: 8.5, heightIn: 11 })), /limited to/);
});
