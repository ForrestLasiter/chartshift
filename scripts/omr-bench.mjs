// Compares music readers on the engraved test pages (where every note is
// known): ChartShift's own reader, and outside programs that write MusicXML
// (homr, oemer, Audiveris). Not part of the app; for choosing an approach.
//   node scripts/omr-bench.mjs <work folder> [--homr path\to\homr.exe] [--oemer path\to\oemer.exe] [filter]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readMusic } from '../src/lib/omr.js';
import { analyse } from '../src/lib/sheet.js';
import { engrave, mei } from '../test/helpers/engrave.mjs';
import { pngBytes } from '../test/helpers/png.mjs';
import * as T from '../test/helpers/tunes.mjs';
import { notesOfMusicXml } from '../test/helpers/musicxml.mjs';

const args = process.argv.slice(2);
const folder = args[0];
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const filter = args.find((a, i) => i > 0 && !a.startsWith('--') && args[i - 1] !== '--homr' && args[i - 1] !== '--oemer');
fs.mkdirSync(folder, { recursive: true });

// Bar-by-bar, staff-by-staff matching, as in test/sheetmusic.test.mjs.
function score(found, truth) {
  const key = (n) => `${n.staff}/${n.measure}/${n.midi}`;
  const want = new Map();
  for (const n of truth) want.set(key(n), (want.get(key(n)) || 0) + 1);
  let hits = 0;
  for (const n of found) if (want.get(key(n)) > 0) { hits++; want.set(key(n), want.get(key(n)) - 1); }
  // Also without bars: a reader that splits bars differently can still have the notes.
  const loose = new Map();
  for (const n of truth) loose.set(`${n.staff}/${n.midi}`, (loose.get(`${n.staff}/${n.midi}`) || 0) + 1);
  let looseHits = 0;
  for (const n of found) { const k = `${n.staff}/${n.midi}`; if (loose.get(k) > 0) { looseHits++; loose.set(k, loose.get(k) - 1); } }
  return { truth: truth.length, found: found.length, hits, looseHits };
}

function ours(img) {
  const result = analyse(readMusic(img));
  const notes = [];
  result.measures.forEach((m, i) => { for (const o of m.onsets) for (const n of o.notes) notes.push({ staff: m.staffs.indexOf(n.staff) + 1, measure: i + 1, midi: n.midi }); });
  return notes;
}

function external(exe, png, outName) {
  const started = Date.now();
  const run = spawnSync(exe, [png], { cwd: path.dirname(png), encoding: 'utf8', env: { ...process.env, PYTHONWARNINGS: 'ignore' }, timeout: 600000 });
  const xmlPath = path.join(path.dirname(png), `${path.basename(png, '.png')}.musicxml`);
  const ms = Date.now() - started;
  if (!fs.existsSync(xmlPath)) return { error: (run.stderr || run.stdout || '').split('\n').filter(Boolean).slice(-2).join(' | '), ms };
  const xml = fs.readFileSync(xmlPath, 'utf8');
  fs.renameSync(xmlPath, path.join(path.dirname(png), `${outName}.musicxml`));
  return { notes: notesOfMusicXml(xml), ms };
}

const cases = { waltz: [T.WALTZ_ABC, 7], hymn: [T.OLD_HUNDREDTH, 7], lead: [T.TERRA_BEATA, 5] };
const styles = { clean: {}, scan: { scale: 26, rotate: 0.5, blur: 1, noise: 0.6 }, photo: { photo: true, blur: 1, noise: 0.4 }, shapes: { shapes: true }, shapesPhoto: { shapes: true, photo: true, blur: 1, noise: 0.4 } };
const engines = { ours: null, homr: opt('--homr'), oemer: opt('--oemer') };
const pct = (s) => (s.error ? `error: ${s.error.slice(0, 60)}` : `${s.hits}/${s.truth} in bars (${s.looseHits} any bar), ${s.found - s.looseHits} extra`);
const totals = {};
for (const [name, [source, tonic]] of Object.entries(cases)) {
  for (const [style, o] of Object.entries(styles)) {
    const id = `${name}-${style}`;
    if (filter && !id.includes(filter)) continue;
    const { img, notes: truth } = await engrave(typeof source === 'string' ? source : mei(source), { ...o, shapes: o.shapes ? tonic : null });
    const png = path.join(folder, `${id}.png`);
    fs.writeFileSync(png, pngBytes(img));
    const line = [id.padEnd(18)];
    for (const [engine, exe] of Object.entries(engines)) {
      if (engine !== 'ours' && !exe) continue;
      let s;
      if (engine === 'ours') { const t = Date.now(); s = { ...score(ours(img), truth), ms: Date.now() - t }; }
      else { const r = external(exe, png, `${id}.${engine}`); s = r.error ? { error: r.error, ms: r.ms } : { ...score(r.notes, truth), ms: r.ms }; }
      line.push(`${engine}: ${pct(s)} [${Math.round(s.ms / 1000)}s]`);
      const t = (totals[engine] ||= { truth: 0, hits: 0, loose: 0, extra: 0 });
      if (!s.error) { t.truth += s.truth; t.hits += s.hits; t.loose += s.looseHits; t.extra += s.found - s.looseHits; }
    }
    console.log(line.join('  |  '));
  }
}
for (const [engine, t] of Object.entries(totals)) console.log(`TOTAL ${engine}: ${t.hits}/${t.truth} in the right bar (${(100 * t.hits / t.truth).toFixed(1)}%), ${t.loose} anywhere on the staff, ${t.extra} extra`);
