// Reading printed words with PaddleOCR's models (PP-OCRv6 small, Apache 2.0,
// as packaged by RapidOCR), run with ONNX Runtime. Much better than
// Tesseract on phone photos: shadows, curved lines and small print.
//
// Two models: one finds the lines of text (a map of where text is), the
// other reads each line (a letter guess for every few pixels across it,
// decoded the standard way: drop repeats and blanks). The reader's guesses
// also say where each letter sits, so every word gets its own position.
//
// The ONNX Runtime module (`ort`) and the model bytes are handed in, so this
// runs the same in the app and in Node tests. No DOM.

const DET_SIDE = 736; // the shorter side the text finder works at
const MAX_SIDE = 2000; // larger pictures are scaled down first
const REC_HEIGHT = 48;
const REC_MIN_WIDTH = 320;

// Bilinear resize of RGBA pixels, to a planar BGR float tensor normalised
// with mean and spread 0.5 (as the models were trained).
// With `slope`, the rows follow a slanted line of text (dy per dx), so a
// tilted line comes out level.
function toTensor(img, x0, y0, w, h, outW, outH, padW = outW, slope = 0) {
  const { data, width, height } = img;
  const plane = outH * padW;
  const t = new Float32Array(3 * plane);
  const sx = w / outW, sy = h / outH;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const fx = x0 + (x + 0.5) * sx - 0.5;
      const fy = y0 + (y + 0.5) * sy - 0.5 + slope * (fx - x0 - w / 2);
      const yA = Math.max(0, Math.min(height - 1, Math.floor(fy))), yB = Math.min(height - 1, yA + 1), wy = Math.min(1, Math.max(0, fy - yA));
      const xA = Math.max(0, Math.min(width - 1, Math.floor(fx))), xB = Math.min(width - 1, xA + 1), wx = Math.min(1, Math.max(0, fx - xA));
      const a = (yA * width + xA) * 4, b = (yA * width + xB) * 4, c = (yB * width + xA) * 4, d = (yB * width + xB) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const v = (data[a + ch] * (1 - wx) + data[b + ch] * wx) * (1 - wy) + (data[c + ch] * (1 - wx) + data[d + ch] * wx) * wy;
        // RGB in, BGR out.
        t[(2 - ch) * plane + y * padW + x] = (v / 255 - 0.5) / 0.5;
      }
    }
  }
  return t;
}

/** Lines of text in a picture: [{ x0, y0, x1, y1 }] (picture pixels). */
async function findLines(ort, session, img) {
  const { width: W, height: H } = img;
  let scale = Math.min(1, MAX_SIDE / Math.max(W, H));
  if (Math.min(W, H) * scale < DET_SIDE) scale = DET_SIDE / Math.min(W, H);
  const dw = Math.max(32, Math.round((W * scale) / 32) * 32), dh = Math.max(32, Math.round((H * scale) / 32) * 32);
  const input = new ort.Tensor('float32', toTensor(img, 0, 0, W, H, dw, dh), [1, 3, dh, dw]);
  const output = Object.values(await session.run({ [session.inputNames[0]]: input }))[0];
  const pred = output.data;
  // Text where the map is over 0.3, grown a pixel (as RapidOCR does).
  const on = new Uint8Array(dw * dh);
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const i = y * dw + x;
    if (pred[i] > 0.3 || (x > 0 && pred[i - 1] > 0.3) || (y > 0 && pred[i - dw] > 0.3) || (x > 0 && y > 0 && pred[i - dw - 1] > 0.3)) on[i] = 1;
  }
  // Connected regions, each a line (or piece of one) of text.
  const label = new Int32Array(dw * dh);
  const boxes = [];
  const stack = [];
  for (let i = 0; i < on.length; i++) {
    if (!on[i] || label[i]) continue;
    const id = boxes.length + 1;
    let x0 = dw, y0 = dh, x1 = -1, y1 = -1;
    label[i] = id;
    stack.push(i);
    while (stack.length) {
      const j = stack.pop();
      const x = j % dw, y = (j - x) / dw;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const k of [j - 1, j + 1, j - dw, j + dw]) {
        if (k < 0 || k >= on.length || label[k] || !on[k]) continue;
        if ((k === j - 1 && x === 0) || (k === j + 1 && x === dw - 1)) continue;
        label[k] = id;
        stack.push(k);
      }
    }
    boxes.push({ x0, y0, x1, y1, id });
  }
  const lines = [];
  for (const b of boxes) {
    const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1;
    if (Math.min(w, h) < 3) continue;
    // Confidence: the map's average over the region itself (on a tilted
    // photo an upright box around a line is mostly paper).
    let sum = 0, n = 0;
    for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) if (label[y * dw + x] === b.id) { sum += pred[y * dw + x]; n++; }
    if (sum / n < 0.5) continue;
    // Its slant, from a straight line fitted through the region.
    let mx = 0, my = 0;
    for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) if (label[y * dw + x] === b.id) { mx += x; my += y; }
    mx /= n; my /= n;
    let sxy = 0, sxx = 0;
    for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) if (label[y * dw + x] === b.id) { sxy += (x - mx) * (y - my); sxx += (x - mx) * (x - mx); }
    const slopeMap = sxx ? sxy / sxx : 0;
    // How tall the line is across its slant.
    let half = 0;
    for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) if (label[y * dw + x] === b.id) half = Math.max(half, Math.abs(y - (my + slopeMap * (x - mx))));
    const slope = (slopeMap * H * dw) / (dh * W);
    // The map marks a shrunken core of each line: grow it back out.
    const th = 2 * half + 1;
    const grow = (w * th * 1.6) / (2 * (w + th));
    const cy = ((my + slopeMap * ((b.x0 + b.x1) / 2 - mx)) * H) / dh;
    const hh = (((th / 2) + grow) * H) / dh;
    lines.push({
      x0: Math.max(0, ((b.x0 - grow) * W) / dw), x1: Math.min(W, ((b.x1 + 1 + grow) * W) / dw),
      y0: Math.max(0, cy - hh), y1: Math.min(H, cy + hh), slope,
    });
  }
  return lines.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
}

/** Reads one line: { text, score, chars: [{ ch, x }] } with x in picture pixels. */
// The reader knows thousands of letters (it reads Chinese too); look-alikes
// of plain English letters and marks are put back as plain ones.
const LOOK_ALIKES = { 'ı': 'i', 'ſ': 's', '‘': "'", '’': "'", '`': "'", '´': "'", '“': '"', '”': '"', '，': ',', '．': '.', '：': ':', '；': ';', '！': '!', '？': '?', '－': '-', '—': '-', '–': '-' };
const plain = (ch) => LOOK_ALIKES[ch] ?? ch;

async function readLine(ort, session, keys, img, line) {
  const x0 = Math.floor(line.x0), y0 = Math.floor(line.y0);
  const w = Math.max(1, Math.ceil(line.x1) - x0), h = Math.max(1, Math.ceil(line.y1) - y0);
  const rw = Math.max(1, Math.ceil((REC_HEIGHT * w) / h));
  const padW = Math.max(REC_MIN_WIDTH, rw);
  const input = new ort.Tensor('float32', toTensor(img, x0, y0, w, h, rw, REC_HEIGHT, padW, line.slope || 0), [1, 3, REC_HEIGHT, padW]);
  const output = Object.values(await session.run({ [session.inputNames[0]]: input }))[0];
  const [, steps, classes] = output.dims;
  const probs = output.data;
  const chars = [];
  let last = 0, total = 0;
  for (let t = 0; t < steps; t++) {
    let best = 0, bestP = -1;
    for (let c = 0; c < classes; c++) { const p = probs[t * classes + c]; if (p > bestP) { bestP = p; best = c; } }
    if (best !== 0 && best !== last) {
      // Index 0 is "no letter here"; the last class is a space.
      const ch = plain(best - 1 < keys.length ? keys[best - 1] : ' ');
      const xr = ((t + 0.5) * padW) / steps;
      chars.push({ ch, x: x0 + (Math.min(xr, rw) * w) / rw, p: bestP });
      total += bestP;
    }
    last = best;
  }
  return { text: chars.map((c) => c.ch).join(''), score: chars.length ? total / chars.length : 0, chars };
}

/**
 * Sets up the reader. ort: the onnxruntime-web module; det, rec: model bytes;
 * keys: the reader's list of letters (one per line).
 */
export async function createPaddleOcr({ ort, det, rec, keys }) {
  const [detSession, recSession] = await Promise.all([ort.InferenceSession.create(det), ort.InferenceSession.create(rec)]);
  const letters = keys.split('\n');
  return {
    /**
     * The words in a picture ({ data: RGBA, width, height }), with where each
     * sits: [{ text, x0, y0, x1, y1, line, score }] in picture pixels.
     */
    async readWords(img, { minScore = 0.5 } = {}) {
      const words = [];
      const lines = await findLines(ort, detSession, img);
      for (const [n, line] of lines.entries()) {
        const read = await readLine(ort, recSession, letters, img, line);
        if (!read.text.trim() || read.score < minScore) continue;
        // Words are the runs of letters between spaces; each letter's place
        // comes from where the reader saw it.
        const gap = (line.y1 - line.y0) * 0.25;
        let word = null;
        for (const c of read.chars) {
          if (c.ch === ' ') { word = null; continue; }
          if (!word) { word = { text: '', x0: c.x - gap, x1: c.x + gap, y0: line.y0, y1: line.y1, line: n + 1, score: read.score }; words.push(word); }
          word.text += c.ch;
          word.x1 = c.x + gap;
        }
      }
      return words;
    },
  };
}
