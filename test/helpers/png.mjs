// Minimal PNG reading and writing (8-bit RGB/RGBA/grey, no interlacing), for
// tests and debugging scripts that look at page pictures.
import fs from 'node:fs';
import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Reads a PNG (a file path or its bytes) into { data: RGBA Uint8ClampedArray, width, height }. */
export function readPng(file) {
  const buf = Buffer.isBuffer(file) ? file : fs.readFileSync(file);
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let width = 0, height = 0, depth = 0, type = 0, interlace = 0;
  const idat = [];
  for (let i = 8; i < buf.length;) {
    const len = buf.readUInt32BE(i), name = buf.toString('latin1', i + 4, i + 8), body = buf.subarray(i + 8, i + 8 + len);
    if (name === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]; type = body[9]; interlace = body[12]; }
    else if (name === 'IDAT') idat.push(body);
    else if (name === 'IEND') break;
    i += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[type];
  if (depth !== 8 || !channels || interlace) throw new Error(`${file}: only 8-bit, non-interlaced grey/RGB/RGBA PNGs are supported`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels] : 0, b = prev ? prev[x] : 0, c = prev && x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[x] = v & 255;
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    if (channels === 1 || channels === 2) { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = pixels[s]; data[i * 4 + 3] = channels === 2 ? pixels[s + 1] : 255; }
    else { data[i * 4] = pixels[s]; data[i * 4 + 1] = pixels[s + 1]; data[i * 4 + 2] = pixels[s + 2]; data[i * 4 + 3] = channels === 4 ? pixels[s + 3] : 255; }
  }
  return { data, width, height };
}

/** Encodes { data: RGBA, width, height } as PNG bytes. */
export function pngBytes({ data, width, height }) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const td = Buffer.concat([Buffer.from(type), body]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
