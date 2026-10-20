// Reads the music and the words on a page picture and prints the chord chart
// (verse by verse) the app would make from it.
//   node scripts/chart-debug.mjs page.png
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorker } from 'tesseract.js';
import { cleanedForReading, readMusic } from '../src/lib/omr.js';
import { analyse } from '../src/lib/sheet.js';
import { chordChart, missingSyllables } from '../src/lib/lyrics.js';
import { pngBytes, readPng } from '../test/helpers/png.mjs';

const [file] = process.argv.slice(2);
const scale = 300 / 72; // the picture is a page drawn at 300 dpi
const img = readPng(file);
const music = readMusic(img);
const result = analyse(music);

const worker = await createWorker('eng', 1, { langPath: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'tesseract'), gzip: true, cachePath: (await import('node:os')).tmpdir() });
const clean = cleanedForReading(img);
const { data } = await worker.recognize(pngBytes(clean), {}, { blocks: true, text: false });
// The same grouping into rows as src/lib/ocr.js.
const words = [];
let lineNumber = 0;
for (const block of data.blocks || []) for (const p of block.paragraphs) for (const line of p.lines) { lineNumber++; for (const w of line.words) {
  const text = w.text.trim();
  if (!text || w.confidence < 20) continue;
  const base = w.baseline && w.baseline.has_baseline !== false ? (w.baseline.y0 + w.baseline.y1) / 2 : w.bbox.y1;
  words.push({ text, x0: w.bbox.x0 / scale, y0: w.bbox.y0 / scale, x1: w.bbox.x1 / scale, y1: w.bbox.y1 / scale, base: base / scale, line: lineNumber });
} }
const rows = [];
for (const word of words.sort((a, b) => a.base - b.base)) {
  const height = word.y1 - word.y0, row = rows[rows.length - 1];
  if (row && Math.abs(row.base - word.base) < Math.max(1.5, 0.3 * Math.min(height, row.height))) { row.tokens.push(word); row.base = (row.base * (row.tokens.length - 1) + word.base) / row.tokens.length; }
  else rows.push({ base: word.base, height, tokens: [word] });
}
for (const row of rows) row.tokens.sort((a, b) => a.x0 - b.x0);
// A closer look where a melody note has no syllable under it.
const crop = (box) => {
  const x0 = Math.max(0, Math.round(box.x0 * scale)), y0 = Math.max(0, Math.round(box.y0 * scale));
  const x1 = Math.min(clean.width - 1, Math.round(box.x1 * scale)), y1 = Math.min(clean.height - 1, Math.round(box.y1 * scale));
  const w = x1 - x0 + 1, h = y1 - y0 + 1, pad = 20;
  const data = new Uint8ClampedArray((w + 2 * pad) * (h + 2 * pad) * 4).fill(255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(clean.data.subarray(((y0 + y) * clean.width + x0 + x) * 4, ((y0 + y) * clean.width + x0 + x) * 4 + 4), ((y + pad) * (w + 2 * pad) + x + pad) * 4);
  return pngBytes({ data, width: w + 2 * pad, height: h + 2 * pad });
};
await worker.setParameters({ tessedit_pageseg_mode: '8' });
const boxes = missingSyllables({ music, result, rows, scale });
for (const box of boxes) {
  const { data: d } = await worker.recognize(crop(box));
  const text = d.text.trim();
  if (process.env.ROWS) console.log('look', Math.round(box.x0), Math.round(box.y0), JSON.stringify(text), Math.round(d.confidence));
  if (!text || d.confidence < 70 || !/[A-Za-z]/.test(text) || !/^[A-Za-z'’,.;:!?-]{1,6}$/.test(text)) continue;
  const row = rows.find((r) => r.tokens.some((t) => t.line === box.line));
  (row || rows[0]).tokens.push({ text, x0: box.x0, x1: box.x1, y0: box.y0, y1: box.y1, base: box.base, line: box.line });
}
for (const row of rows) row.tokens.sort((a, b) => a.x0 - b.x0);
await worker.terminate();
if (process.env.ROWS) for (const r of rows) console.log(Math.round(r.base), r.tokens.map((t) => t.text).join(' '));
console.log(chordChart({ music, result, rows, scale }, { title: path.basename(file, '.png') }));
