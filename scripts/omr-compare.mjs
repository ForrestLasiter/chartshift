// Shows two readings of a real page side by side, bar by bar: ChartShift's
// reader (on the page picture as the app sees it) and an outside reader's
// MusicXML. For working out the true notes where they disagree.
//   node scripts/omr-compare.mjs page.png other.musicxml
import fs from 'node:fs';
import { readMusic } from '../src/lib/omr.js';
import { analyse } from '../src/lib/sheet.js';
import { readPng } from '../test/helpers/png.mjs';
import { notesOfMusicXml } from '../test/helpers/musicxml.mjs';

const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const nm = (m) => NAMES[m % 12] + (Math.floor(m / 12) - 1);
const [png, xmlFile] = process.argv.slice(2);
const result = analyse(readMusic(readPng(png)));
const mine = new Map();
result.measures.forEach((m, i) => { for (const o of m.onsets) for (const n of o.notes) { const k = `${m.staffs.indexOf(n.staff) + 1}/${i + 1}`; if (!mine.has(k)) mine.set(k, []); mine.get(k).push(n.midi); } });
const theirs = new Map();
for (const n of notesOfMusicXml(fs.readFileSync(xmlFile, 'utf8'))) { const k = `${n.staff}/${n.measure}`; if (!theirs.has(k)) theirs.set(k, []); theirs.get(k).push(n.midi); }
const bars = Math.max(result.measures.length, ...[...theirs.keys()].map((k) => Number(k.split('/')[1])));
for (let b = 1; b <= bars; b++) {
  for (const staff of [1, 2]) {
    const a = (mine.get(`${staff}/${b}`) || []).slice().sort((x, y) => y - x).map(nm).join(' ');
    const t = (theirs.get(`${staff}/${b}`) || []).slice().sort((x, y) => y - x).map(nm).join(' ');
    console.log(`bar ${String(b).padStart(2)} staff ${staff}: ${a === t ? 'same ' : 'DIFF '} ours: ${a.padEnd(40)} other: ${t}`);
  }
}
