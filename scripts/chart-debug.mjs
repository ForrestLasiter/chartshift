// Reads the music and the words on a page picture and prints the chord chart
// (verse by verse) the app would make from it, using PaddleOCR for the words.
//   node scripts/chart-debug.mjs page.png
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ort from 'onnxruntime-web';
import { readMusic } from '../src/lib/omr.js';
import { analyse } from '../src/lib/sheet.js';
import { chordChart, lyricBands } from '../src/lib/lyrics.js';
import { createPaddleOcr } from '../src/lib/paddleocr.js';
import { readPng } from '../test/helpers/png.mjs';

const [file] = process.argv.slice(2);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const scale = 300 / 72; // the picture is a page drawn at 300 dpi
const img = readPng(file);
const music = readMusic(img);
const result = analyse(music);

const model = (name) => fs.readFileSync(path.join(root, 'public', 'paddleocr', name));
const ocr = await createPaddleOcr({ ort, det: model('PP-OCRv6_det_small.onnx'), rec: model('PP-OCRv6_rec_small.onnx'), keys: model('rec_keys.txt').toString('utf8') });

// As the app: the bands of words between the staffs, each read on its own.
const tokens = [];
for (const band of lyricBands(music)) {
  const x0 = Math.round(band.x0), y0 = Math.round(band.y0);
  const w = Math.min(img.width - x0, Math.round(band.x1 - band.x0)), h = Math.min(img.height - y0, Math.round(band.y1 - band.y0));
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) data.set(img.data.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + w) * 4), y * w * 4);
  for (const word of await ocr.readWords({ data, width: w, height: h })) {
    tokens.push({ text: word.text, x0: (word.x0 + x0) / scale, x1: (word.x1 + x0) / scale, y0: (word.y0 + y0) / scale, y1: (word.y1 + y0) / scale, base: ((word.y0 + word.y1) / 2 + y0) / scale, line: 1000 * (band.system + 1) + word.line });
  }
}
if (process.env.ROWS) console.log(tokens.map((t) => t.text).join(' '));
console.log(chordChart([{ music, result, rows: [{ base: 0, tokens }], scale }], { title: path.basename(file, '.png') }));
