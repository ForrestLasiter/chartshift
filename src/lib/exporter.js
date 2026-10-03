import { PDFDocument } from 'pdf-lib';
import { renderPageCanvas } from './render.js';

const EXPORT_DPI = 300;

const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 0));

async function pagePng(page, atlases) {
  const canvas = renderPageCanvas(page, atlases, EXPORT_DPI);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
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

export async function printImages(pages, atlases, onProgress) {
  const out = [];
  for (let i = 0; i < pages.length; i++) {
    onProgress?.(`Preparing page ${i + 1} of ${pages.length}…`);
    await nextFrame();
    out.push({ png: await pagePng(pages[i], atlases), widthIn: pages[i].w / 72, heightIn: pages[i].h / 72 });
  }
  return out;
}
