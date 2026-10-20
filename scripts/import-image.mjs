// Opens a photo or scan the way the app does (fit to a Letter page, whiten
// and straighten, cut into pieces) and draws the page as the music reader
// sees it, at 300 dpi. For testing the reader on real photos without the app.
//   node scripts/import-image.mjs <photo.jpg|png> <out.png>
import fs from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { estimateSkew, flattenBackground } from '../src/lib/cleanup.js';
import { segment } from '../src/lib/segment.js';
import { pngBytes } from '../test/helpers/png.mjs';

const [file, out] = process.argv.slice(2);
const bytes = fs.readFileSync(file);
const type = /\.png$/i.test(file) ? 'png' : 'jpeg';
// The picture's own size, from a first render.
const probe = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/${type};base64,${bytes.toString('base64')}"/></svg>`);
const box = probe.innerBBox() || probe.getBBox();
const iw = Math.round(box.width), ih = Math.round(box.height);

// As importImage: a Letter page in the picture's orientation, at least 150 dpi, at most 3600 px.
const landscape = iw > ih;
const w = landscape ? 792 : 612, h = landscape ? 612 : 792;
const s = Math.min(3600 / Math.max(w, h), Math.max(iw / w, ih / h, 150 / 72));
const cw = Math.round(w * s), ch = Math.round(h * s);
const fit = Math.min(cw / iw, ch / ih);
const dw = iw * fit, dh = ih * fit;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}"><rect width="100%" height="100%" fill="white"/><image x="${(cw - dw) / 2}" y="${(ch - dh) / 2}" width="${dw}" height="${dh}" preserveAspectRatio="none" href="data:image/${type};base64,${bytes.toString('base64')}"/></svg>`;
const r = new Resvg(svg).render();
let img = { data: new Uint8ClampedArray(r.pixels), width: r.width, height: r.height };

// As cleanScan: whiten an uneven background, then straighten.
const uneven = flattenBackground(img);
const angle = estimateSkew(img);
if (angle) {
  const { data, width: W, height: H } = img;
  const rot = new Uint8ClampedArray(data.length).fill(255);
  const a = (-angle * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - W / 2, dy = y - H / 2;
      const sx = Math.round(dx * cos - dy * sin + W / 2), sy = Math.round(dx * sin + dy * cos + H / 2);
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
      rot.set(data.subarray((sy * W + sx) * 4, (sy * W + sx) * 4 + 4), (y * W + x) * 4);
    }
  }
  img = { data: rot, width: W, height: H };
}

// As pageFromCanvas: cut into pieces, then draw the pieces back at 300 dpi.
const { atlases, pieces } = segment(img, { speckScale: 2, faint: !uneven });
const scale = 300 / 72 / s;
const W = Math.round(cw * scale), H = Math.round(ch * scale);
const rgb = new Float32Array(W * H).fill(255);
for (const p of pieces) {
  const at = atlases[p.atlas];
  const x0 = Math.round(p.x * scale), y0 = Math.round(p.y * scale);
  const pw = Math.max(1, Math.round(p.w * scale)), ph = Math.max(1, Math.round(p.h * scale));
  for (let y = 0; y < ph; y++) {
    const sy = p.sy + Math.min(p.h - 1, Math.floor(((y + 0.5) * p.h) / ph));
    for (let x = 0; x < pw; x++) {
      const tx = x0 + x, ty = y0 + y;
      if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
      const sx = p.sx + Math.min(p.w - 1, Math.floor(((x + 0.5) * p.w) / pw));
      const k = (sy * at.width + sx) * 4, alpha = at.data[k + 3] / 255;
      if (alpha) rgb[ty * W + tx] = rgb[ty * W + tx] * (1 - alpha) + at.data[k] * alpha;
    }
  }
}
const page = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < W * H; i++) { page[i * 4] = page[i * 4 + 1] = page[i * 4 + 2] = rgb[i]; page[i * 4 + 3] = 255; }
fs.writeFileSync(out, pngBytes({ data: page, width: W, height: H }));
console.log(`photo ${iw}x${ih}; page ${cw}x${ch}; ${uneven ? 'whitened, ' : ''}${angle ? `turned ${angle.toFixed(2)}°, ` : ''}${pieces.length} pieces; wrote ${W}x${H}`);
