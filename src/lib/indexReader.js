// Reads the index of a church's hymnal into lines of text: from photos of
// its pages, a PDF (its own text when it has some, otherwise read like a
// photo), or a text file. App only (uses the DOM).
import { wordReader } from './wordReader.js';
import { pdfPages } from './importer.js';

const MAX_SIDE = 2400; // big enough for small index print, small enough to read quickly

// The words read off one picture, as rows of text across the page. Words
// are put in a row by their height on the page, not by the reader's own
// lines: an index's dot leaders leave a gap that splits a title from its
// number. (Two columns make one row with two entries, which the index
// parser expects.)
function linesOfWords(words) {
  const rows = [];
  for (const w of [...words].sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1))) {
    const middle = (w.y0 + w.y1) / 2, height = w.y1 - w.y0;
    const row = rows.find((r) => Math.abs(r.middle - middle) < 0.45 * Math.max(height, r.height));
    if (row) { row.words.push(w); row.middle = (row.middle * (row.words.length - 1) + middle) / row.words.length; }
    else rows.push({ middle, height, words: [w] });
  }
  return rows.sort((a, b) => a.middle - b.middle).map((r) => r.words.sort((a, b) => a.x0 - b.x0).map((w) => w.text).join(' '));
}

async function readPicture(reader, source, width, height) {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return linesOfWords(await reader.readWords({ data: img.data, width: img.width, height: img.height }));
}

/**
 * The index's text, from the files given (File objects): one string with a
 * line per index line. progress(message) is told how it is going.
 */
export async function readIndexFiles(files, progress = () => {}) {
  const lines = [];
  let reader = null;
  const ocr = async () => {
    if (!reader) { progress('Getting the word reader ready…'); reader = await wordReader(); }
    return reader;
  };
  for (const [n, file] of [...files].entries()) {
    const name = file.name || `file ${n + 1}`;
    if (/\.(txt|csv|tsv)$/i.test(name) || file.type.startsWith('text/')) {
      lines.push(...(await file.text()).split(/\r?\n/));
      continue;
    }
    if (/\.pdf$/i.test(name) || file.type === 'application/pdf') {
      const data = new Uint8Array(await file.arrayBuffer());
      for await (const page of pdfPages(data, 200)) {
        progress(`Reading ${name}, page ${page.number} of ${page.count}…`);
        if (page.text.length >= 5) lines.push(...page.text);
        else lines.push(...(await readPicture(await ocr(), page.canvas, page.canvas.width, page.canvas.height)));
      }
      continue;
    }
    progress(`Reading ${name}…`);
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try { lines.push(...(await readPicture(await ocr(), bitmap, bitmap.width, bitmap.height))); } finally { bitmap.close(); }
  }
  return lines.join('\n');
}
