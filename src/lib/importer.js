import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { segment } from './segment.js';
import { estimateSkew, flattenBackground } from './cleanup.js';
import { applyTokens, rowsFromPdfText } from './textlayer.js';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const ASSETS = new URL('./pdfjs/', document.baseURI).href;
const RENDER_DPI = 300;
const MAX_SIDE = 3600;
const LETTER = { w: 612, h: 792 };

const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 0));

// Scans get their lighting evened out and are straightened before being cut up.
function cleanScan(canvas, ctx, notes) {
  let img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  if (flattenBackground(img)) {
    ctx.putImageData(img, 0, 0);
    notes.whitened++;
  }
  const angle = estimateSkew(img);
  if (angle) {
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    copy.getContext('2d').drawImage(canvas, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((angle * Math.PI) / 180);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(copy, -canvas.width / 2, -canvas.height / 2);
    ctx.restore();
    img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    notes.straightened++;
  }
  return img;
}

// Splits a rendered page into pieces and appends its sprite atlases to `atlases`.
function pageFromCanvas(canvas, w, h, ids, atlases, scan, notes) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = scan ? cleanScan(canvas, ctx, notes) : ctx.getImageData(0, 0, canvas.width, canvas.height);
  const result = segment(img, { speckScale: scan ? 2 : 1 });
  const s = canvas.width / w;
  const atlasBase = atlases.length;
  for (const a of result.atlases) {
    const c = document.createElement('canvas');
    c.width = a.width;
    c.height = a.height;
    c.getContext('2d').putImageData(new ImageData(a.data, a.width, a.height), 0, 0);
    atlases.push(c);
  }
  const groupBase = ids.group;
  let groupMax = 0;
  const pieces = result.pieces.map((p) => {
    groupMax = Math.max(groupMax, p.word, p.line, p.block);
    return {
      id: ids.piece++,
      kind: 'clip',
      x: p.x / s, y: p.y / s, w: p.w / s, h: p.h / s,
      atlas: atlasBase + p.atlas, sx: p.sx, sy: p.sy, sw: p.w, sh: p.h,
      word: groupBase + p.word, line: groupBase + p.line, block: groupBase + p.block,
      ...(p.frame ? { frame: true } : null),
      ...(p.contained ? { contained: true } : null),
    };
  });
  ids.group = groupBase + groupMax + 1;
  return { id: ids.page++, w, h, pieces, sections: [] };
}

const newNotes = () => ({ scans: 0, whitened: 0, straightened: 0, chords: 0 });

/** @returns {Promise<{pages: object[], notes: object}>} */
export async function importPdf(data, ids, atlases, onProgress) {
  const pdf = await pdfjs.getDocument({
    data: data.slice(),
    cMapUrl: ASSETS + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: ASSETS + 'standard_fonts/',
    wasmUrl: ASSETS + 'wasm/',
    iccUrl: ASSETS + 'iccs/',
  }).promise;
  const pages = [];
  const notes = newNotes();
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      onProgress?.(`Reading page ${n} of ${pdf.numPages}…`);
      await nextFrame();
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(RENDER_DPI / 72, MAX_SIDE / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const canvasContext = canvas.getContext('2d', { willReadFrequently: true });
      canvasContext.fillStyle = '#ffffff';
      canvasContext.fillRect(0, 0, canvas.width, canvas.height);
      // 'print' intent renders without waiting on animation frames, so importing
      // keeps going while the window is minimised or covered.
      await page.render({ canvas, canvasContext, viewport, intent: 'print' }).promise;

      // A page with no text of its own is a scan (just a picture of the paper).
      const textContent = await page.getTextContent();
      const scan = !textContent.items.some((item) => item.str && item.str.trim());
      if (scan) notes.scans++;
      const out = pageFromCanvas(canvas, base.width, base.height, ids, atlases, scan, notes);
      if (!scan) {
        const fontNames = new Map();
        for (const name of Object.keys(textContent.styles)) {
          try { fontNames.set(name, page.commonObjs.get(name)?.name || ''); } catch { /* font not loaded */ }
        }
        const rows = rowsFromPdfText(textContent, base.transform, pdfjs.Util.transform, fontNames);
        notes.chords += applyTokens(out.pieces, rows, ids).chords;
      }
      pages.push(out);
      page.cleanup();
    }
  } finally {
    await pdf.loadingTask.destroy();
  }
  return { pages, notes };
}

// A photo or scan image becomes one Letter-size page, scaled to fit.
export async function importImage(data, ids, atlases, onProgress) {
  onProgress?.('Reading image…');
  await nextFrame();
  const bitmap = await createImageBitmap(new Blob([data]));
  const landscape = bitmap.width > bitmap.height;
  const w = landscape ? LETTER.h : LETTER.w;
  const h = landscape ? LETTER.w : LETTER.h;
  const s = Math.min(MAX_SIDE / Math.max(w, h), Math.max(bitmap.width / w, bitmap.height / h, 150 / 72));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * s);
  canvas.height = Math.round(h * s);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const fit = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height);
  const dw = bitmap.width * fit, dh = bitmap.height * fit;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
  bitmap.close();
  const notes = newNotes();
  notes.scans = 1;
  return { pages: [pageFromCanvas(canvas, w, h, ids, atlases, true, notes)], notes };
}
