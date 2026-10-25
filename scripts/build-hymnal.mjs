// Builds the hymn library the app looks songs up in (public/hymnal/hymns.json)
// from two free sources:
//   - WorshipCommons (github.com/ChurchApps/WorshipCommonsContent): its
//     catalog.json, with a hand-written chord chart for most songs and, for
//     many hymns, the full score (ABC). Only English songs that may be passed
//     on are used: public domain and Creative Commons. Songs under the
//     WorshipCommons License or a writer's own permission are free for a
//     church's worship, not for an app to hand out, so they are left out.
//   - The Open Hymnal Project (github.com/mzealey/openhymnal), for hymns
//     WorshipCommons does not have.
//
//   node scripts/build-hymnal.mjs --wc <catalog.json> --cache <folder> [--openhymnal <checkout>] [--out <file>]
//
// Scores WorshipCommons names are downloaded into the cache folder once.
// Each song is stored as a finished chord chart (ChordPro text), so the app
// does no music work when a song is opened:
//   - with a score: every verse from the score, lined up with the tune, and
//     the chords of WorshipCommons' hand-written first verse and chorus put
//     on every verse at the same place in the tune (or, where the chart does
//     not fit the score, chords worked out from the four parts);
//   - without one: the hand-written chart, its later verses set out again
//     like the first where they were run together;
//   - Open Hymnal only: chords worked out from the four parts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hymnChart } from '../src/lib/hymn.js';
import { sectionsText, tidyChart } from '../src/lib/chartGuide.js';
import { normalTitle } from '../src/lib/hymnIndex.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, a, i, all) => (a.startsWith('--') ? [...pairs, [a.slice(2), all[i + 1]]] : pairs), []));
if (!args.wc || !args.cache) {
  console.error('usage: node scripts/build-hymnal.mjs --wc <catalog.json> --cache <folder> [--openhymnal <checkout>] [--out <file>]');
  process.exit(1);
}
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = args.out || path.join(root, 'public', 'hymnal', 'hymns.json');
const RAW = 'https://raw.githubusercontent.com/ChurchApps/WorshipCommonsContent/main/';
const SHAREABLE = new Set(['PD', 'CC-BY', 'CC-BY-SA']);

const plain = (line) => line.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
// The first line as sung, up to the first comma or stop that ends a phrase
// (not one straight after a word like "Alas," or "Come,").
const firstLineOf = (text) => {
  const line = text.split('\n').find((l) => l.trim() && !/^\{/.test(l) && !/^(verse|chorus|refrain)\b/i.test(l.trim()));
  if (!line) return '';
  const words = plain(line);
  const stop = [...words.matchAll(/[,;:.!?—]/g)].find((m) => m.index >= 14);
  return (stop ? words.slice(0, stop.index) : words).trim();
};
const hasChords = (text) => /\[[A-G][^\]]{0,8}\]/.test(text || '');

async function score(url) {
  const file = path.join(args.cache, url.replace(/[\\/:]/g, '_'));
  if (fs.existsSync(file)) return fs.readFileSync(file, 'latin1');
  const response = await fetch(RAW + url.split('/').map(encodeURIComponent).join('/'));
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  fs.mkdirSync(args.cache, { recursive: true });
  fs.writeFileSync(file, bytes);
  return bytes.toString('latin1');
}

const hymns = [];
const counts = { guided: 0, worked: 0, tidied: 0, words: 0, openhymnal: 0 };
const rows = JSON.parse(fs.readFileSync(args.wc, 'utf8')).rows
  .filter((r) => r.language === 'English' && SHAREABLE.has(r.license) && r.status === 'approved');
for (const r of rows) {
  const credit = r.license === 'PD' ? 'Public domain'
    : `${r.attribution || r.writer} · ${r.license.replace('CC-', 'CC ')} ${r.licenseVersion || '4.0'}`.trim();
  let chart = null, how = null;
  if (r.abcUrl) {
    try {
      const made = hymnChart(await score(r.abcUrl), { chart: hasChords(r.chordPro) ? r.chordPro : null, chartKey: r.songKey });
      if (made.verses) { chart = made.text; how = made.guided ? 'guided' : 'worked'; }
    } catch (e) { console.log(`  score not used for ${r.title}: ${e.message}`); }
  }
  if (!chart && r.chordPro) {
    const head = [`{title: ${r.title}}`, r.songKey ? `{key: ${r.songKey}}` : '', r.timeSignature ? `{time: ${r.timeSignature}}` : ''].filter(Boolean);
    chart = head.join('\n') + '\n\n' + sectionsText(tidyChart(r.chordPro));
    how = hasChords(r.chordPro) ? 'tidied' : 'words';
  }
  if (!chart) continue;
  counts[how]++;
  hymns.push({ id: `wc:${r.id}`, title: r.title, firstLine: firstLineOf(chart), writer: r.writer || '', year: r.year || null, credit, source: 'WorshipCommons', chart });
}

if (args.openhymnal) {
  const known = new Set(hymns.flatMap((h) => [normalTitle(h.title), normalTitle(h.firstLine)]));
  const complete = path.join(args.openhymnal, 'Complete');
  for (const dir of fs.readdirSync(complete).sort()) {
    for (const file of fs.readdirSync(path.join(complete, dir)).filter((f) => f.endsWith('.abc')).sort()) {
      try {
        const made = hymnChart(fs.readFileSync(path.join(complete, dir, file), 'latin1'));
        const firstLine = firstLineOf(made.text);
        if (!made.verses || known.has(normalTitle(made.title)) || known.has(normalTitle(firstLine))) continue;
        known.add(normalTitle(made.title));
        counts.openhymnal++;
        hymns.push({ id: `oh:${dir}/${file.replace(/\.abc$/, '')}`, title: made.title, firstLine, writer: '', year: null, credit: 'Public domain', source: 'Open Hymnal Project', chart: made.text });
      } catch (e) { console.log(`  left out ${dir}/${file}: ${e.message}`); }
    }
  }
}

hymns.sort((a, b) => a.title.localeCompare(b.title));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({
  sources: [
    'WorshipCommons (worshipcommons.org), public-domain and Creative Commons songs',
    'Open Hymnal Project (openhymnal.org)',
  ],
  hymns,
}));
console.log(`${hymns.length} songs written to ${path.relative(root, out)} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
console.log(`  WorshipCommons: ${counts.guided} with chords moved onto the score, ${counts.worked} with chords from the score's parts, ${counts.tidied} from the chart, ${counts.words} words only`);
console.log(`  Open Hymnal Project: ${counts.openhymnal}`);
