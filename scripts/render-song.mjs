// Draws one page of a saved song (.chartshift) as a PNG, the way the app
// draws it for reading (image pieces only), to look into what a reader saw.
//   node scripts/render-song.mjs <song.chartshift> <out.png> [page=1] [dpi=300]
import fs from 'node:fs';
import JSZip from 'jszip';
import { pngBytes, readPng } from '../test/helpers/png.mjs';

const [file, out, pageArg = '1', dpiArg = '300'] = process.argv.slice(2);
const zip = await JSZip.loadAsync(fs.readFileSync(file));
const song = JSON.parse(await zip.file('song.json').async('string'));
const page = song.pages[Number(pageArg) - 1];
const scale = Number(dpiArg) / 72;

// Sprite sheets as RGBA pixels.
const atlases = [];
for (let i = 0; i < song.atlasCount; i++) {
  const png = await zip.file(`atlas-${i}.png`).async('nodebuffer');
  atlases.push(readPng(png));
}

const W = Math.round(page.w * scale), H = Math.round(page.h * scale);
const rgb = new Float32Array(W * H * 3).fill(255);
for (const p of page.pieces) {
  if (p.kind !== 'clip') continue;
  const a = atlases[p.atlas];
  const x0 = Math.round(p.x * scale), y0 = Math.round(p.y * scale);
  const dw = Math.max(1, Math.round(p.w * scale)), dh = Math.max(1, Math.round(p.h * scale));
  for (let y = 0; y < dh; y++) {
    const ty = y0 + y;
    if (ty < 0 || ty >= H) continue;
    const sy = p.sy + Math.min(p.sh - 1, Math.floor(((y + 0.5) * p.sh) / dh));
    for (let x = 0; x < dw; x++) {
      const tx = x0 + x;
      if (tx < 0 || tx >= W) continue;
      const sx = p.sx + Math.min(p.sw - 1, Math.floor(((x + 0.5) * p.sw) / dw));
      const s = (sy * a.width + sx) * 4, alpha = a.data[s + 3] / 255;
      if (!alpha) continue;
      const t = (ty * W + tx) * 3;
      for (let c = 0; c < 3; c++) rgb[t + c] = rgb[t + c] * (1 - alpha) + a.data[s + c] * alpha;
    }
  }
}
const data = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < W * H; i++) { data[i * 4] = rgb[i * 3]; data[i * 4 + 1] = rgb[i * 3 + 1]; data[i * 4 + 2] = rgb[i * 3 + 2]; data[i * 4 + 3] = 255; }

fs.writeFileSync(out, pngBytes({ data, width: W, height: H }));
console.log('wrote', out, W, 'x', H);
