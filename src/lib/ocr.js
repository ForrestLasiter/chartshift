// OCR for scanned pages (Tesseract, bundled so it works offline).
// Produces the same rows-of-tokens shape that textlayer.js consumes.
import { createWorker } from 'tesseract.js';

const ASSETS = new URL('./tesseract/', document.baseURI).href;

let workerPromise = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      workerPath: ASSETS + 'worker.min.js',
      corePath: ASSETS,
      langPath: ASSETS,
      gzip: true,
      workerBlobURL: false,
    }).catch((error) => { workerPromise = null; throw error; });
  }
  return workerPromise;
}

/** Recognises the words on a rendered page. `scale` is canvas pixels per point. */
export async function recognise(canvas, scale) {
  const worker = await getWorker();
  const { data } = await worker.recognize(canvas, {}, { blocks: true, text: false });
  const words = [];
  for (const block of data.blocks || []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        for (const word of line.words) {
          const text = word.text.trim();
          if (!text || word.confidence < 20) continue;
          const { x0, y0, x1, y1 } = word.bbox;
          const base = word.baseline && word.baseline.has_baseline !== false ? (word.baseline.y0 + word.baseline.y1) / 2 : y1;
          words.push({ text, x0: x0 / scale, y0: y0 / scale, x1: x1 / scale, y1: y1 / scale, base: base / scale });
        }
      }
    }
  }
  return rowsByBaseline(words);
}

/**
 * Groups words into rows by where they sit on the page, not by the lines the
 * OCR engine reports: it tends to attach a chord to the lyric line beneath
 * it, which hides the chord row. Words on one baseline form one row.
 */
export function rowsByBaseline(words) {
  const rows = [];
  for (const word of words.slice().sort((a, b) => a.base - b.base)) {
    const height = word.y1 - word.y0;
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.base - word.base) < Math.max(1.5, 0.3 * Math.min(height, row.height))) {
      row.tokens.push(word);
      row.base = (row.base * (row.tokens.length - 1) + word.base) / row.tokens.length;
    } else {
      rows.push({ ff: 'sans', base: word.base, height, tokens: [word] });
    }
  }
  for (const row of rows) row.tokens.sort((a, b) => a.x0 - b.x0);
  return rows;
}

/**
 * Reads one word from a small picture of it. Reading a page at a time, the
 * engine often skips a lone letter; shown just that letter, enlarged, it
 * usually gets it. Returns the readings to try, best first.
 */
export async function readWord(canvas) {
  const worker = await getWorker();
  const readings = [];
  try {
    for (const mode of ['10', '8']) { // single character, then single word
      await worker.setParameters({ tessedit_pageseg_mode: mode });
      const { data } = await worker.recognize(canvas);
      const text = data.text.trim();
      if (text && !readings.includes(text)) readings.push(text);
    }
  } finally {
    await worker.setParameters({ tessedit_pageseg_mode: '6' }); // back to page reading
  }
  return readings;
}
