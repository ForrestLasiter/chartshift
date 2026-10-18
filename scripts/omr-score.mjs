// Scores the music reader on the engraved test pieces in several styles
// (clean, scanned, photographed, shape notes, shape notes photographed).
//   node scripts/omr-score.mjs [filter, e.g. "hymn/photo"]
import { readMusic } from '../src/lib/omr.js';
import { analyse } from '../src/lib/sheet.js';
import { engrave, mei } from '../test/helpers/engrave.mjs';
import * as T from '../test/helpers/tunes.mjs';
const N = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
const nm = (m) => N[m % 12] + (Math.floor(m / 12) - 1);
const cases = { waltz: [T.WALTZ_ABC, 7], hymn: [T.OLD_HUNDREDTH, 7], lead: [T.TERRA_BEATA, 5] };
const opts = { clean: {}, scan: { scale: 26, rotate: 0.5, blur: 1, noise: 0.6 }, photo: { photo: true, blur: 1, noise: 0.4 }, shapes: { shapes: true }, shapesPhoto: { shapes: true, photo: true, blur: 1, noise: 0.4 } };
const only = process.argv[2];
for (const [name, [src, tonic]] of Object.entries(cases)) for (const [on, o] of Object.entries(opts)) {
  if (only && !`${name}/${on}`.includes(only)) continue;
  const { img, notes } = await engrave(typeof src === 'string' ? src : mei(src), { ...o, shapes: o.shapes ? tonic : null });
  const music = readMusic(img); const r = analyse(music);
  const want = new Map(); for (const n of notes) { const k = `${n.staff}/${n.measure}`; if (!want.has(k)) want.set(k, []); want.get(k).push(n.midi); }
  const got = new Map(); r.measures.forEach((m, i) => { for (const o2 of m.onsets) for (const n of o2.notes) { const k = `${m.staffs.indexOf(n.staff) + 1}/${i + 1}`; if (!got.has(k)) got.set(k, []); got.get(k).push(n.midi); } });
  const errs = []; let miss = 0, extra = 0;
  for (const k of new Set([...want.keys(), ...got.keys()])) {
    const a = (want.get(k) || []).slice(), b = (got.get(k) || []).slice();
    const m = a.filter((x) => { const i = b.indexOf(x); if (i >= 0) { b.splice(i, 1); return false; } return true; });
    miss += m.length; extra += b.length;
    if (m.length || b.length) errs.push(`${k}: missing ${m.map(nm).join(',')} extra ${b.map(nm).join(',')}`);
  }
  console.log(`${name}/${on}: ${notes.length - miss}/${notes.length} found, ${extra} extra; staffs ${music.staffs.map((s) => s.clef + s.fifths).join(' ')} bars ${r.measures.length}${errs.length ? '\n   ' + errs.slice(0, 4).join('\n   ') : ''}`);
}
