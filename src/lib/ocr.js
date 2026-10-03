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
  const rows = [];
  for (const block of data.blocks || []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        const tokens = [];
        for (const word of line.words) {
          const text = word.text.trim();
          if (!text || word.confidence < 20) continue;
          const { x0, y0, x1, y1 } = word.bbox;
          tokens.push({ text, x0: x0 / scale, y0: y0 / scale, x1: x1 / scale, y1: y1 / scale });
        }
        if (tokens.length) rows.push({ ff: 'sans', tokens });
      }
    }
  }
  return rows;
}
