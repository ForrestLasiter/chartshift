// Prints what a PDF's own text layer contains: fonts, and each text item with
// its position. Useful when chords or headings are not being picked up.
// Usage: node scripts/inspect-pdf.mjs "<file.pdf>" [page]
import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const [file, only] = process.argv.slice(2);
if (!file) { console.error('usage: node scripts/inspect-pdf.mjs <file.pdf> [page]'); process.exit(1); }
const pdf = await getDocument({ data: new Uint8Array(readFileSync(file)), useSystemFonts: true }).promise;
console.log(`${pdf.numPages} page(s)`);
for (let n = 1; n <= pdf.numPages; n++) {
  if (only && Number(only) !== n) continue;
  const page = await pdf.getPage(n);
  const view = page.getViewport({ scale: 1 });
  const text = await page.getTextContent();
  const ops = await page.getOperatorList();
  console.log(`\n--- page ${n}: ${Math.round(view.width)} x ${Math.round(view.height)} pt, ${text.items.length} text items, ${ops.fnArray.length} drawing operations`);
  const fonts = {};
  for (const name of Object.keys(text.styles)) {
    let real = '';
    try { real = page.commonObjs.get(name)?.name || ''; } catch { /* not loaded */ }
    fonts[name] = `${real} (${text.styles[name].fontFamily})`;
  }
  console.log('fonts:', fonts);
  for (const item of text.items) {
    if (!item.str.trim()) continue;
    const [, , , d, x, y] = item.transform;
    const codes = [...item.str].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) > 0x2fff) ? ` codes=${[...item.str].map((c) => c.charCodeAt(0).toString(16)).join(',')}` : '';
    console.log(`${String(Math.round(x)).padStart(4)},${String(Math.round(view.height - y)).padStart(4)} size ${Math.abs(d).toFixed(1).padStart(5)} ${item.fontName.padEnd(12)} ${JSON.stringify(item.str)}${codes}`);
  }
}
