// Shows what the music reader finds on an engraved test tune or an image.
//   node scripts/omr-debug.mjs <tune.abc|piece.mjs|page.png> [out.png]
// Writes a picture with the found staffs, bar lines and notes marked.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';
import { readMusic } from '../src/lib/omr.js';
import { analyse } from '../src/lib/sheet.js';
import { sheetText } from '../src/lib/tab.js';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { engrave, mei } from '../test/helpers/engrave.mjs';

const [file, out = 'omr-debug.png'] = process.argv.slice(2);
let img, truth = null;
if (/\.png$/i.test(file)) {
  const r = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,${fs.readFileSync(file).toString('base64')}"/></svg>`);
  const { width, height } = r.innerBBox() || {};
  const page = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><image width="${width}" height="${height}" href="data:image/png;base64,${fs.readFileSync(file).toString('base64')}"/></svg>`, { background: 'white' }).render();
  img = { data: new Uint8ClampedArray(page.pixels), width: page.width, height: page.height };
} else {
  const source = fs.readFileSync(file, 'utf8');
  const options = JSON.parse(process.env.ENGRAVE || '{}');
  // A .mjs file exports a piece described for the test helper's mei().
  const piece = /\.mjs$/.test(file) ? mei((await import(pathToFileURL(path.resolve(file)).href)).default) : source;
  const engraved = await engrave(piece, options);
  img = engraved.img;
  truth = engraved.notes;
}

const t0 = Date.now();
const music = readMusic(img, { debug: !!process.env.OMR_SYM });
if (music.debug) {
  const { sym, width, height } = music.debug;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < sym.length; i++) { const v = sym[i] ? 0 : 255; data.set([v, v, v, 255], i * 4); }
  fs.writeFileSync(process.env.OMR_SYM, rgbaToPng({ data, width, height }));
}
console.log(`read in ${Date.now() - t0} ms; slope ${music.slope.toFixed(4)}`);
for (const s of music.staffs) console.log(`staff ${s.index}: space ${s.space.toFixed(1)} clef ${s.clef} fifths ${s.fifths} bars ${s.bars.map(Math.round).join(',')} header ${Math.round(s.headerEnd)}`);
console.log('systems', music.systems.map((s) => s.staffs.join('+')).join('  '));
const names = (list) => list.map((n) => `${n.name}${n.octave}`).join(' ');
for (const s of music.staffs) console.log(`found  ${s.index}: ${names(music.notes.filter((n) => n.staff === s.index).sort((a, b) => a.x - b.x || b.y - a.y))}`);
if (truth) {
  const LET = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const byStaff = new Map();
  for (const n of truth) { if (!byStaff.has(n.staff)) byStaff.set(n.staff, []); byStaff.get(n.staff).push(n); }
  for (const [staff, list] of byStaff) console.log(`truth ${staff}: ${list.map((n) => `${LET[n.midi % 12]}${Math.floor(n.midi / 12) - 1}`).join(' ')}`);
}

const result = analyse(music);
console.log('chords', result.measures.map((m) => m.chords.map((c) => c.name).join(' ')).join(' | '));
console.log(sheetText(result, { title: path.basename(file) }));

// Overlay: staffs blue, bars green, notes red with their names.
const marks = [];
for (const s of music.staffs) {
  for (const y of s.lines) marks.push(`<line x1="${s.x0}" x2="${s.x1}" y1="${y}" y2="${y}" stroke="blue" stroke-opacity="0.35" stroke-width="2"/>`);
  for (const b of s.bars) marks.push(`<line x1="${b}" x2="${b}" y1="${s.lines[0] - 10}" y2="${s.lines[4] + 10}" stroke="lime" stroke-width="4" stroke-opacity="0.6"/>`);
  marks.push(`<line x1="${s.headerEnd}" x2="${s.headerEnd}" y1="${s.lines[0]}" y2="${s.lines[4]}" stroke="orange" stroke-width="3"/>`);
}
for (const n of music.notes) {
  marks.push(`<circle cx="${n.x}" cy="${n.y}" r="9" fill="none" stroke="red" stroke-width="3"/>`);
  marks.push(`<text x="${n.x - 10}" y="${n.y + 40 * (n.stem === 'up' ? 1 : -0.6)}" font-size="22" fill="red" font-family="Arial">${n.name}${n.octave}·${n.duration}</text>`);
}
const b64 = rgbaToPng(img).toString('base64');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${img.width}" height="${img.height}"><image width="${img.width}" height="${img.height}" href="data:image/png;base64,${b64}"/>${marks.join('')}</svg>`;
fs.writeFileSync(out, new Resvg(svg, { font: { loadSystemFonts: true } }).render().asPng());
console.log('wrote', out);

// Minimal PNG encoder for the overlay background.
function rgbaToPng({ data, width, height }) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const td = Buffer.concat([Buffer.from(type), body]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
