// Copies the runtime assets for pdf.js (fonts, character maps, image decoders)
// and Tesseract (OCR engine + English data) into public/ so the app can read
// every kind of PDF and recognise text while fully offline.
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modules = join(root, 'node_modules');

const pdfjs = join(root, 'public', 'pdfjs');
mkdirSync(pdfjs, { recursive: true });
for (const dir of ['standard_fonts', 'cmaps', 'wasm', 'iccs']) {
  cpSync(join(modules, 'pdfjs-dist', dir), join(pdfjs, dir), { recursive: true });
}

const ocr = join(root, 'public', 'tesseract');
mkdirSync(ocr, { recursive: true });
cpSync(join(modules, 'tesseract.js', 'dist', 'worker.min.js'), join(ocr, 'worker.min.js'));
for (const file of readdirSync(join(modules, 'tesseract.js-core'))) {
  if (file.endsWith('-lstm.wasm.js')) cpSync(join(modules, 'tesseract.js-core', file), join(ocr, file));
}
cpSync(join(modules, '@tesseract.js-data', 'eng', '4.0.0', 'eng.traineddata.gz'), join(ocr, 'eng.traineddata.gz'));

console.log('pdf.js and OCR assets copied to public/');
