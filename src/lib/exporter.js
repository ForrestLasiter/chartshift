import { PDFDocument } from 'pdf-lib';
import { renderPageCanvas } from './render.js';

const EXPORT_DPI = 300;
const MAX_SIDE = 9000; // pixels; very large pages are rendered at a lower dpi

const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 0));

// A page as a PNG; `quarterTurn` rotates it 90° clockwise (landscape onto portrait paper).
async function pagePng(page, atlases, quarterTurn = false) {
  const dpi = Math.min(EXPORT_DPI, (MAX_SIDE * 72) / Math.max(page.w, page.h));
  let canvas = renderPageCanvas(page, atlases, dpi);
  if (quarterTurn) {
    const turned = document.createElement('canvas');
    turned.width = canvas.height;
    turned.height = canvas.width;
    const ctx = turned.getContext('2d');
    ctx.translate(turned.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(canvas, 0, 0);
    canvas = turned;
  }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('A page is too large to turn into a picture.');
  return new Uint8Array(await blob.arrayBuffer());
}

async function appendPages(pdf, pages, atlases, onProgress, label = '') {
  for (let i = 0; i < pages.length; i++) {
    onProgress?.(`Writing ${label}page ${i + 1} of ${pages.length}…`);
    await nextFrame();
    const image = await pdf.embedPng(await pagePng(pages[i], atlases));
    const out = pdf.addPage([pages[i].w, pages[i].h]);
    out.drawImage(image, { x: 0, y: 0, width: pages[i].w, height: pages[i].h });
  }
}

export async function exportPdf(pages, atlases, onProgress) {
  const pdf = await PDFDocument.create();
  pdf.setCreator('ChartShift');
  await appendPages(pdf, pages, atlases, onProgress);
  return pdf.save();
}

/** One PDF holding several songs in order. songs = [{ name, pages, atlases }]. */
export async function exportSetlistPdf(songs, onProgress) {
  const pdf = await PDFDocument.create();
  pdf.setCreator('ChartShift');
  for (const song of songs) await appendPages(pdf, song.pages, song.atlases, onProgress, `${song.name}, `);
  return pdf.save();
}

/**
 * Page pictures for printing. `plan` (from planPrint) gives the sheet each
 * page goes on; the picture is fitted and centred on that sheet when printed.
 */
export async function printImages(pages, atlases, onProgress, plan) {
  const out = [];
  for (let i = 0; i < pages.length; i++) {
    onProgress?.(`Preparing page ${i + 1} of ${pages.length}…`);
    await nextFrame();
    const sheet = plan?.[i] ?? { w: pages[i].w, h: pages[i].h, rotate: false };
    out.push({ png: await pagePng(pages[i], atlases, sheet.rotate), widthIn: sheet.w / 72, heightIn: sheet.h / 72 });
  }
  return out;
}
