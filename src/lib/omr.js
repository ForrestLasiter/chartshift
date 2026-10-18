// Reading printed sheet music (optical music recognition).
//
// Finds the staffs on a page, takes the staff lines away, and then looks for
// what is left: note heads (filled, and hollow for half and whole notes),
// their stems, beams and dots, clefs, key signatures, accidentals and bar
// lines. Each note gets a pitch from where it sits on its staff.
//
// It is made for clean printed music: hymnals, songbooks, lead sheets and
// method books. Hand-written music, very small print and photographs taken
// at an angle are beyond it. Pure function, no DOM: runs in Node for tests.
import { labelComponents } from './segment.js';

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const SEMITONE = [0, 2, 4, 5, 7, 9, 11];
// The note each clef puts on the bottom line, counted in letter steps from C0.
const BOTTOM_LINE = { treble: 4 * 7 + 2, treble8: 3 * 7 + 2, bass: 2 * 7 + 4 };
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B, as letter numbers
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3]; // B E A D G C F

function otsu(hist, total) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, threshold = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > best) { best = between; threshold = i; }
  }
  return threshold + 1;
}

// Black-and-white version of the page: 1 = ink.
function inkOf({ data, width: W, height: H }) {
  const N = W * H;
  const v = new Uint8Array(N);
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; i < N; i++, p += 4) {
    const a = data[p + 3];
    let m = Math.min(data[p], data[p + 1], data[p + 2]);
    if (a < 255) m = Math.round((m * a + 255 * (255 - a)) / 255);
    v[i] = m;
    hist[m]++;
  }
  let bg = 255, peak = 0;
  for (let i = 128; i < 256; i++) if (hist[i] >= peak) { peak = hist[i]; bg = i; }
  const T = Math.min(otsu(hist, N), bg - 24);
  const ink = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (v[i] < T) ink[i] = 1;
  return ink;
}

// Long horizontal strokes in one row: calls back (start, end) for each run of
// ink at least `min` long. Gaps of a pixel or two (paper grain, a worn line)
// do not break a run.
function eachLongRun(ink, W, y, min, fn) {
  const o = y * W;
  let start = -1, last = -1;
  for (let x = 0; x <= W; x++) {
    const on = x < W && ink[o + x];
    if (on) { if (start < 0) start = x; last = x; continue; }
    if (start >= 0 && x - last > 2) {
      if (last - start + 1 >= min) fn(start, last + 1);
      start = -1;
    }
  }
}

// Small tilt of the page, as the slope of its staff lines (dy per dx).
function estimateSlope(ink, W, H) {
  const xs = [], ys = [];
  const minRun = Math.max(40, W / 30);
  for (let y = 0; y < H; y++) eachLongRun(ink, W, y, minRun, (start, end) => { for (let k = start; k < end; k += 6) { xs.push(k); ys.push(y); } });
  if (xs.length < 50) return 0;
  let best = 0, bestScore = -1;
  const bins = new Int32Array(H + W);
  for (let deg = -2; deg <= 2.0001; deg += 0.05) {
    const t = Math.tan((deg * Math.PI) / 180);
    bins.fill(0);
    const offset = W;
    for (let i = 0; i < xs.length; i++) bins[Math.round(ys[i] - xs[i] * t) + offset]++;
    let score = 0;
    for (let i = 0; i < bins.length; i++) score += bins[i] * bins[i];
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return best;
}

// The page sheared so that staff lines run straight across.
function straightened(ink, W, H, slope) {
  if (!slope) return ink;
  const out = new Uint8Array(W * H);
  for (let x = 0; x < W; x++) {
    const shift = Math.round(x * slope);
    for (let y = 0; y < H; y++) {
      const sy = y + shift;
      if (sy >= 0 && sy < H && ink[sy * W + x]) out[y * W + x] = 1;
    }
  }
  return out;
}

// Staff line thickness and spacing, from the commonest vertical runs of ink
// and of ink-plus-gap down the page.
function lineMetrics(ink, W, H) {
  const inkRuns = new Uint32Array(80), periods = new Uint32Array(240);
  for (let x = Math.floor(W * 0.1); x < W * 0.9; x += 3) {
    let y = 0, prevInk = -1;
    while (y < H) {
      const on = ink[y * W + x];
      let len = 0;
      while (y < H && ink[y * W + x] === on) { y++; len++; }
      if (on) {
        if (len < 80) inkRuns[len]++;
        prevInk = len;
      } else if (prevInk > 0 && y < H) {
        const p = prevInk + len;
        if (p < 240) periods[p]++;
      }
    }
  }
  const mode = (h, from) => { let b = from; for (let i = from; i < h.length; i++) if (h[i] > h[b]) b = i; return b; };
  const thickness = mode(inkRuns, 1);
  const period = mode(periods, thickness + 3);
  return { thickness, period };
}

// The vertical run of ink through (x, y): [top, bottom], or null.
function vRun(img, W, H, x, y) {
  if (x < 0 || x >= W || y < 0 || y >= H || !img[y * W + x]) return null;
  let a = y, b = y;
  while (a > 0 && img[(a - 1) * W + x]) a--;
  while (b < H - 1 && img[(b + 1) * W + x]) b++;
  return [a, b];
}

function hRun(img, W, x, y) {
  const o = y * W;
  if (x < 0 || x >= W || !img[o + x]) return null;
  let a = x, b = x;
  while (a > 0 && img[o + a - 1]) a--;
  while (b < W - 1 && img[o + b + 1]) b++;
  return [a, b];
}

// Rows that are mostly long horizontal strokes, merged into lines.
function findLines(ink, W, H, space) {
  const minRun = Math.max(20, Math.round(3 * space));
  const amount = new Float64Array(H), from = new Int32Array(H).fill(W), to = new Int32Array(H).fill(-1);
  for (let y = 0; y < H; y++) {
    eachLongRun(ink, W, y, minRun, (start, end) => {
      amount[y] += end - start;
      if (start < from[y]) from[y] = start;
      if (end - 1 > to[y]) to[y] = end - 1;
    });
  }
  let max = 0;
  for (let y = 0; y < H; y++) if (amount[y] > max) max = amount[y];
  const limit = Math.max(max * 0.3, minRun * 2);
  const lines = [];
  let cur = null;
  for (let y = 0; y < H; y++) {
    if (amount[y] >= limit) {
      if (cur && y - cur.y1 <= 1) {
        cur.y1 = y; cur.sum += amount[y] * y; cur.weight += amount[y];
        cur.x0 = Math.min(cur.x0, from[y]); cur.x1 = Math.max(cur.x1, to[y]);
      } else {
        cur = { y0: y, y1: y, sum: amount[y] * y, weight: amount[y], x0: from[y], x1: to[y] };
        lines.push(cur);
      }
    }
  }
  for (const L of lines) L.y = L.sum / L.weight;
  return lines;
}

// Five evenly spaced lines make a staff.
function groupStaffs(lines, period) {
  const staffs = [];
  for (let i = 0; i + 4 < lines.length;) {
    const five = lines.slice(i, i + 5);
    const gaps = five.slice(1).map((L, k) => L.y - five[k].y);
    const mean = gaps.reduce((a, b) => a + b, 0) / 4;
    const even = gaps.every((g) => g > 0.8 * mean && g < 1.2 * mean) && mean > 0.6 * period && mean < 1.6 * period;
    const x0 = Math.max(...five.map((L) => L.x0)), x1 = Math.min(...five.map((L) => L.x1));
    if (even && x1 - x0 > 10 * mean) {
      staffs.push({ lines: five.map((L) => L.y), thick: Math.max(...five.map((L) => L.y1 - L.y0 + 1)), space: mean, x0, x1 });
      i += 5;
    } else i++;
  }
  return staffs;
}

// Takes staff lines (and ledger lines) away wherever nothing else crosses them.
function removeLines(ink, W, H, staffs, thickness) {
  const out = ink.slice();
  const limit = thickness + 2;
  const clear = (yc, x0, x1) => {
    const y = Math.round(yc);
    for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) {
      let hit = -1;
      for (let d = 0; d <= thickness && hit < 0; d++) {
        if (y - d >= 0 && out[(y - d) * W + x]) hit = y - d;
        else if (y + d < H && out[(y + d) * W + x]) hit = y + d;
      }
      if (hit < 0) continue;
      const run = vRun(out, W, H, x, hit);
      if (run[1] - run[0] + 1 <= limit) for (let k = run[0]; k <= run[1]; k++) out[k * W + x] = 0;
    }
  };
  for (const s of staffs) {
    for (const y of s.lines) clear(y, s.x0 - 2, s.x1 + 2);
  }
  // Ledger lines: short, thin, at whole spaces above and below the staff.
  for (const s of staffs) {
    for (let k = 1; k <= 5; k++) {
      for (const yc of [s.lines[0] - k * s.space, s.lines[4] + k * s.space]) {
        const y = Math.round(yc);
        if (y < 0 || y >= H) continue;
        for (let x = s.x0; x <= s.x1;) {
          let best = null;
          for (let d = -thickness; d <= thickness; d++) {
            const r = hRun(out, W, x, y + d);
            if (r && (!best || r[1] - r[0] > best[1] - best[0])) best = r;
          }
          if (best && best[1] - best[0] > 1.1 * s.space && best[1] - best[0] < 4 * s.space) {
            clear(yc, best[0], best[1]);
            x = best[1] + 1;
          } else x++;
        }
      }
    }
  }
  return out;
}

function integral(img, W, H) {
  const S = new Int32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += img[y * W + x];
      S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + row;
    }
  }
  return S;
}

/**
 * Reads the music on one page.
 * @param {{data: Uint8ClampedArray, width: number, height: number}} img  RGBA pixels
 * @returns {{ staffs: object[], systems: object[], notes: object[], slope: number }}
 *   Positions are in the image's pixels. Each note: { x, y, staff, step, letter,
 *   octave, alter, midi, name, duration, hollow, stem: 'up'|'down'|null }.
 */
export function readMusic(img, { debug = false } = {}) {
  const { width: W, height: H } = img;
  const raw = inkOf(img);
  const slope = estimateSlope(raw, W, H);
  const ink = straightened(raw, W, H, slope);
  const { thickness, period } = lineMetrics(ink, W, H);
  const staffs = groupStaffs(findLines(ink, W, H, Math.max(8, period)), period);
  if (!staffs.length) return { staffs: [], systems: [], notes: [], slope };

  const sym = removeLines(ink, W, H, staffs, thickness);
  const labels = new Int32Array(W * H);
  const comps = [];
  labelComponents(sym, W, H, labels, comps);
  comps.forEach((c) => { c.w = c.x1 - c.x0 + 1; c.h = c.y1 - c.y0 + 1; });
  const labelAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : labels[y * W + x]);
  const S = integral(sym, W, H);
  const box = (x0, y0, x1, y1) => {
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W - 1, x1); y1 = Math.min(H - 1, y1);
    if (x1 < x0 || y1 < y0) return 0;
    return S[(y1 + 1) * (W + 1) + x1 + 1] - S[y0 * (W + 1) + x1 + 1] - S[(y1 + 1) * (W + 1) + x0] + S[y0 * (W + 1) + x0];
  };

  // Each staff looks after the band around it, up to halfway to its neighbours.
  staffs.sort((a, b) => a.lines[0] - b.lines[0]);
  staffs.forEach((s, i) => {
    const above = i > 0 ? staffs[i - 1].lines[4] : -Infinity;
    const below = i < staffs.length - 1 ? staffs[i + 1].lines[0] : Infinity;
    s.index = i;
    s.top = Math.max(0, Math.round(Math.max(s.lines[0] - 6 * s.space, (above + s.lines[0]) / 2)));
    s.bottom = Math.min(H - 1, Math.round(Math.min(s.lines[4] + 6 * s.space, (s.lines[4] + below) / 2)));
  });

  // A stem: a long thin upright stroke joined to the head.
  const stemOf = (s, cx, cy, label, other = label) => {
    const sp = s.space;
    let best = null;
    for (let x = Math.round(cx - 0.95 * sp); x <= cx + 0.95 * sp; x++) {
      for (const dy of [-0.3, 0, 0.3]) {
        const y = Math.round(cy + dy * sp);
        const run = vRun(sym, W, H, x, y);
        if (!run || (label && labelAt(x, y) !== label && labelAt(x, y) !== other)) continue;
        const len = run[1] - run[0] + 1;
        if (!best || len > best.len) best = { x, top: run[0], bottom: run[1], len };
      }
    }
    if (!best || best.len < 2.4 * sp) return null;
    best.dir = best.bottom - cy > cy - best.top ? 'down' : 'up';
    return best;
  };

  // Beams or flags on a stem: thick strokes leaving the stem near its tip.
  const beamsOn = (s, stem, cy) => {
    const sp = s.space;
    const tip = stem.dir === 'up' ? stem.top : stem.bottom;
    const reach = Math.min(2.6 * sp, Math.abs(tip - cy) - 1.0 * sp);
    let count = 0, inBeam = false, gap = 0;
    for (let d = 0; d <= reach; d++) {
      const y = stem.dir === 'up' ? tip + d : tip - d;
      let wide = false;
      for (let x = stem.x - 2; x <= stem.x + 2 && !wide; x++) {
        const run = hRun(sym, W, x, y);
        if (run && run[1] - run[0] + 1 >= 0.75 * sp) wide = true;
      }
      if (wide) { if (!inBeam) count++; inBeam = true; gap = 0; } else if (inBeam && ++gap > 1) inBeam = false;
    }
    return Math.min(count, 4);
  };

  // Augmentation dot to the right of a head.
  const dotted = (s, head) => {
    const sp = s.space;
    for (let x = Math.round(head.x1 + 0.15 * sp); x < head.x1 + 1.3 * sp; x++) {
      for (let y = Math.round(head.cy - 0.75 * sp); y <= head.cy + 0.3 * sp; y++) {
        const l = labelAt(x, y);
        if (!l) continue;
        const c = comps[l - 1];
        if (c.w >= 0.25 * sp && c.w <= 0.7 * sp && c.h >= 0.25 * sp && c.h <= 0.7 * sp && c.area >= 0.4 * c.w * c.h) return true;
      }
    }
    return false;
  };

  // --- Note heads ----------------------------------------------------------
  const heads = [];
  const core = new Uint8Array(W * H);
  for (const s of staffs) {
    const sp = s.space;
    const bw = Math.max(1, Math.round(0.3 * sp)), bh = Math.max(1, Math.round(0.24 * sp));
    const full = (2 * bw + 1) * (2 * bh + 1);
    for (let y = s.top + bh; y <= s.bottom - bh; y++) {
      for (let x = s.x0 + bw; x <= s.x1 - bw; x++) {
        if (sym[y * W + x] && box(x - bw, y - bh, x + bw, y + bh) === full) core[y * W + x] = 1;
      }
    }
  }
  const coreLabels = new Int32Array(W * H);
  const cores = [];
  labelComponents(core, W, H, coreLabels, cores);
  for (const c of cores) {
    const cx = (c.x0 + c.x1) / 2, cy = (c.y0 + c.y1) / 2;
    const s = staffs.find((t) => cy >= t.top && cy <= t.bottom && cx >= t.x0 && cx <= t.x1);
    if (!s) continue;
    const sp = s.space;
    const w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1;
    if (w > 1.0 * sp) continue;
    // Heads a step apart can touch and leave one tall core.
    const n = Math.max(1, Math.round((h + 0.45 * sp) / (0.95 * sp)));
    for (let k = 0; k < n; k++) {
      const hy = n === 1 ? cy : c.y0 + ((k + 0.5) * h) / n;
      const fill = box(Math.round(cx - 0.45 * sp), Math.round(hy - 0.28 * sp), Math.round(cx + 0.45 * sp), Math.round(hy + 0.28 * sp));
      const area = (2 * Math.round(0.45 * sp) + 1) * (2 * Math.round(0.28 * sp) + 1);
      if (fill < 0.8 * area) continue;
      const label = labelAt(Math.round(cx), Math.round(hy));
      const stem = stemOf(s, cx, hy, label);
      if (!stem) continue;
      // The head's own width: the ink run across its middle, short of the stem.
      const run = hRun(sym, W, Math.round(cx), Math.round(hy)) || [cx - 0.6 * sp, cx + 0.6 * sp];
      if (run[1] - run[0] > 2.2 * sp) continue;
      heads.push({ staff: s, cx, cy: hy, x0: run[0], x1: run[1], hollow: false, stem, label });
    }
  }

  // Hollow heads: small enclosed holes with a ring of ink round them.
  // A column of ink from the top line to the bottom one (a bar line, or a long stem).
  const fullColumnIn = (s, x0, x1) => {
    const top = Math.round(s.lines[0]), bottom = Math.round(s.lines[4]);
    for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) {
      let n = 0;
      for (let y = top; y <= bottom; y++) n += sym[y * W + x];
      if (n >= 0.96 * (bottom - top + 1)) return true;
    }
    return false;
  };
  // A ring joined to a filled head is a curled flag or beam, not a note.
  const filledLabels = new Set(heads.map((h) => h.label));
  // Looked for both without the staff lines and with them: a head sitting
  // against a line can lose the edge of its ring when the line is taken away.
  const holes = [];
  for (const source of [sym, ink]) {
    const paper = new Uint8Array(W * H);
    for (const s of staffs) {
      for (let y = s.top; y <= s.bottom; y++) for (let x = s.x0; x <= s.x1; x++) if (!source[y * W + x]) paper[y * W + x] = 1;
    }
    const holeLabels = new Int32Array(W * H);
    const first = holes.length;
    labelComponents(paper, W, H, holeLabels, holes);
    for (let i = first; i < holes.length; i++) { holes[i].labels = holeLabels; holes[i].id = i + 1; }
  }
  const holeLabelsOf = (hole) => hole.labels;
  // Narrower near its top and bottom than across the middle, as an oval is.
  const oval = (hole, holeLabels) => {
    const widthAt = (y) => {
      let n = 0;
      for (let x = hole.x0; x <= hole.x1; x++) if (holeLabels[y * W + x] === hole.id) n++;
      return n;
    };
    // Averaged over the top and bottom quarters, so a ragged edge does not count.
    const h = hole.y1 - hole.y0 + 1;
    let widest = 1, ends = 0, rows = 0;
    for (let y = hole.y0; y <= hole.y1; y++) {
      const w = widthAt(y);
      if (w > widest) widest = w;
      if (y - hole.y0 < h / 4 || hole.y1 - y < h / 4) { ends += w; rows++; }
    }
    return ends / rows < 0.85 * widest;
  };
  for (const hole of holes) {
    const w = hole.x1 - hole.x0 + 1, h = hole.y1 - hole.y0 + 1;
    const cx = (hole.x0 + hole.x1) / 2, cy = (hole.y0 + hole.y1) / 2;
    const s = staffs.find((t) => cy > t.top && cy < t.bottom && cx > t.x0 && cx < t.x1);
    if (!s) continue;
    const sp = s.space;
    // The inside of a head is a slanted oval; gaps boxed in by lines and stems are square.
    if (w < 0.3 * sp || w > 1.1 * sp || h < 0.18 * sp || h > 0.95 * sp || hole.area < 0.45 * w * h || hole.area > 0.9 * w * h) continue;
    if (!oval(hole, holeLabelsOf(hole))) continue;
    // Enclosed: the hole must not reach the band's edge.
    if (hole.y0 <= s.top || hole.y1 >= s.bottom) continue;
    const row = Math.round(cy);
    let left = hole.x0 - 1, right = hole.x1 + 1;
    while (left > 0 && sym[row * W + left - 1] && hole.x0 - left < sp) left--;
    while (right < W - 1 && sym[row * W + right + 1] && right - hole.x1 < sp) right++;
    const outer = right - left + 1;
    if (outer < 0.95 * sp || outer > 2.0 * sp) continue;
    // At least one side of the hole is the ring itself, short and curved; a
    // gap boxed in by a bar line and a stem has long straight strokes on both.
    const sideRun = (x) => { const r = vRun(sym, W, H, x, row); return r ? r[1] - r[0] + 1 : 0; };
    if (Math.min(sideRun(hole.x0 - 1), sideRun(hole.x1 + 1)) > 1.4 * sp) continue;
    // The gap inside a double bar line is boxed in by bar lines on both sides.
    if (fullColumnIn(s, left, hole.x0 - 1) && fullColumnIn(s, hole.x1 + 1, right)) continue;
    // Taking the staff lines away can cut a ring in two, so either side counts.
    const label = labelAt(hole.x0 - 1, row), other = labelAt(hole.x1 + 1, row) || label;
    if (!label || filledLabels.has(label) || filledLabels.has(other)) continue;
    const comp = comps[label - 1];
    const stem = stemOf(s, cx, cy, label, other);
    // A gap half way up a bar line is not a note on the end of a stem.
    if (stem && stem.top <= s.lines[0] + 0.2 * sp && stem.bottom >= s.lines[4] - 0.2 * sp && Math.min(cy - stem.top, stem.bottom - cy) > 0.8 * sp) continue;
    if (!stem && !(comp.h <= 1.4 * sp && outer >= 1.3 * sp && comp.w <= 2.4 * sp)) continue;
    // The hole's own middle can be off when a staff line cuts across it; the
    // ring's sides give the head's true height (the side without the stem).
    let middle = cy;
    const sides = [left + 1, left + 2, right - 1, right - 2]
      .map((x) => vRun(sym, W, H, x, row))
      .filter((r) => r && r[1] - r[0] + 1 <= 1.3 * sp && r[1] - r[0] + 1 >= 0.5 * sp)
      .sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
    if (sides.length && Math.abs((sides[0][0] + sides[0][1]) / 2 - cy) < 0.35 * sp) middle = (sides[0][0] + sides[0][1]) / 2;
    heads.push({ staff: s, cx, cy: middle, x0: left, x1: right, hollow: true, stem, label, other });
  }

  // --- Bar lines -------------------------------------------------------------
  const isStemLabel = new Set(heads.flatMap((h) => [h.label, h.other || h.label]));
  for (const s of staffs) {
    const top = Math.round(s.lines[0]), bottom = Math.round(s.lines[4]);
    const span = bottom - top + 1;
    const stemXs = heads.filter((h) => h.stem && h.staff === s).map((h) => h.stem.x);
    const xs = [];
    for (let x = s.x0 - 3; x <= s.x1 + 3; x++) {
      if (x < 0 || x >= W) continue;
      let n = 0;
      for (let y = top; y <= bottom; y++) n += sym[y * W + x];
      if (n >= 0.96 * span && !stemXs.some((sx) => Math.abs(sx - x) <= 2)) xs.push(x);
    }
    const bars = [];
    for (const x of xs) {
      const last = bars[bars.length - 1];
      if (last && x - last.x1 <= 1) last.x1 = x; else bars.push({ x0: x, x1: x });
    }
    s.bars = bars.filter((b) => b.x1 - b.x0 + 1 <= 0.8 * s.space).map((b) => (b.x0 + b.x1) / 2);
  }

  // --- Clefs, key signatures --------------------------------------------------
  const compsIn = (s, x0, x1, reach = 3) => {
    const seen = new Set(), out = [];
    for (let x = Math.max(0, Math.round(x0)); x <= Math.min(W - 1, x1); x++) {
      for (let y = Math.max(0, Math.round(s.lines[0] - reach * s.space)); y <= Math.min(H - 1, s.lines[4] + reach * s.space); y++) {
        const l = labelAt(x, y);
        if (l && !seen.has(l)) { seen.add(l); out.push(comps[l - 1]); }
      }
    }
    return out;
  };
  // Upright strokes at least `share` of the symbol's height: [{ top, bottom }].
  const uprights = (c, share) => {
    const found = [];
    let inStroke = false;
    for (let x = c.x0; x <= c.x1; x++) {
      // The longest run down this column, bridging one-pixel gaps.
      let best = 0, top = -1, last = -1, bestTop = 0;
      for (let y = c.y0; y <= c.y1 + 2; y++) {
        const on = y <= c.y1 && labels[y * W + x] === c.index;
        if (on) { if (top < 0 || y - last > 2) top = y; last = y; if (last - top + 1 > best) { best = last - top + 1; bestTop = top; } }
      }
      const tall = best >= share * c.h;
      const stroke = { top: bestTop, bottom: bestTop + best - 1 };
      if (tall && !inStroke) found.push(stroke);
      else if (tall && best > found[found.length - 1].bottom - found[found.length - 1].top + 1) found[found.length - 1] = stroke;
      inStroke = tall;
    }
    return found;
  };
  const strokes = (c, share) => uprights(c, share).length;
  const widthIn = (c, y0, y1) => {
    let lo = Infinity, hi = -Infinity;
    for (let y = Math.round(y0); y <= y1; y++) for (let x = c.x0; x <= c.x1; x++) if (labels[y * W + x] === c.index) { if (x < lo) lo = x; if (x > hi) hi = x; }
    return hi >= lo ? hi - lo + 1 : 0;
  };
  comps.forEach((c, i) => { c.index = i + 1; });
  const accidentalKind = (c, sp) => {
    if (c.h < 1.6 * sp || c.h > 3.8 * sp || c.w > 1.5 * sp || c.w < 0.4 * sp) return null;
    // Sharps and naturals both have two upright strokes; a flat has one,
    // with a bulb at the bottom.
    const two = uprights(c, 0.55);
    if (two.length >= 2 && c.h >= 2.1 * sp) {
      // A natural's strokes are staggered: one from the top, one to the bottom.
      const [a, b] = [two[0], two[two.length - 1]];
      return Math.abs(a.top - b.top) > 0.15 * c.h || Math.abs(a.bottom - b.bottom) > 0.15 * c.h ? 'natural' : 'sharp';
    }
    if (strokes(c, 0.75) === 1 && widthIn(c, c.y0, c.y0 + c.h / 3) <= 0.4 * sp && widthIn(c, c.y1 - c.h / 3, c.y1) >= 0.45 * sp && c.w <= 1.2 * sp && c.h <= 3.2 * sp) return 'flat';
    return null;
  };

  const used = new Set();
  for (const s of staffs) {
    const sp = s.space;
    const start = s.bars.length && s.bars[0] - s.x0 < 1.5 * sp ? s.bars[0] + 2 : s.x0;
    const candidates = compsIn(s, start, start + 4.5 * sp).filter((c) => c.w >= 0.6 * sp && c.x0 >= start - sp);
    let tallest = null;
    for (const c of candidates) if (!tallest || c.h > tallest.h) tallest = c;
    // Faint or thin parts of a clef can be lost with the staff lines, leaving
    // it in pieces: the pieces stacked in the same place make up the clef.
    let clef = null;
    if (tallest) {
      const stacked = candidates.filter((c) => c.area >= 0.05 * sp * sp && Math.min(c.x1, tallest.x1) - Math.max(c.x0, tallest.x0) >= 0.5 * Math.min(c.w, tallest.w));
      // A small 8 hanging well below the staff is not part of the clef itself.
      const eight = stacked.find((c) => c !== tallest && c.y0 > s.lines[4] + 1.5 * sp && c.h < 1.5 * sp && c.h > 0.5 * sp);
      const parts = stacked.filter((c) => c !== eight);
      clef = { x0: Math.min(...parts.map((c) => c.x0)), x1: Math.max(...parts.map((c) => c.x1)), y0: Math.min(...parts.map((c) => c.y0)), y1: Math.max(...parts.map((c) => c.y1)), parts };
      clef.w = clef.x1 - clef.x0 + 1; clef.h = clef.y1 - clef.y0 + 1;
      clef.eight = eight;
    }
    s.clef = null;
    if (clef) {
      if (clef.h >= 5 * sp && clef.y0 < s.lines[0] - 0.4 * sp && clef.y1 > s.lines[4] + 0.4 * sp) {
        s.clef = 'treble';
        // A small 8 under the clef: music that sounds an octave lower (guitar, tenor).
        const below = clef.eight || compsIn(s, clef.x0, clef.x1, 4.5).find((c) => !clef.parts.includes(c) && c.y0 > clef.y1 - 0.4 * sp && c.y0 < clef.y1 + 1.2 * sp && c.h < 1.4 * sp && c.h > 0.5 * sp);
        if (below) { s.clef = 'treble8'; used.add(below.index); }
        // ...or joined on to the clef's tail, making it reach further down.
        else if (clef.y1 > s.lines[4] + 2.1 * sp) s.clef = 'treble8';
      } else if (clef.h >= 2.4 * sp && clef.h <= 4.6 * sp && Math.abs(clef.y0 - s.lines[0]) < 0.8 * sp && clef.y1 < s.lines[4] + 0.6 * sp) {
        s.clef = 'bass';
      }
    }
    if (s.clef) for (const c of clef.parts) used.add(c.index);
    s.headerEnd = clef && s.clef ? clef.x1 + (s.clef === 'bass' ? 1.0 * sp : 0) : start;
    if (s.clef === 'bass') {
      // The two dots after a bass clef.
      for (const c of compsIn(s, clef.x1, clef.x1 + 1.2 * sp)) if (c.h < 0.7 * sp && c.w < 0.7 * sp) { used.add(c.index); s.headerEnd = Math.max(s.headerEnd, c.x1); }
    }
    // Key signature: a run of sharps or flats straight after the clef.
    let kind = null, count = 0, x = s.headerEnd;
    const after = compsIn(s, s.headerEnd + 1, s.headerEnd + 9 * sp).filter((c) => c.x0 > s.headerEnd && !used.has(c.index) && c.area >= 0.1 * sp * sp).sort((a, b) => a.x0 - b.x0);
    for (const c of after) {
      if (c.x0 - x > 1.6 * sp) break;
      const k = accidentalKind(c, sp);
      if (!k || k === 'natural' || (kind && k !== kind) || isStemLabel.has(c.index)) break;
      kind = k; count++; x = c.x1; used.add(c.index);
      if (count === 7) break;
    }
    s.fifths = kind === 'sharp' ? count : kind === 'flat' ? -count : 0;
    s.headerEnd = x;
    // Time signature: bold figures filling the top and bottom halves of the
    // staff (or one C), straight after the key.
    // Smudged figures can run together into one shape the height of the staff.
    const near = compsIn(s, x + 1, x + 3.5 * sp).filter((c) => c.x0 > x && c.x0 - x < 2 * sp && !used.has(c.index) && c.w <= 2.2 * sp);
    const figures = near.filter((c) => (c.h >= 1.4 * sp && c.h <= 2.6 * sp && c.w >= 0.7 * sp && !isStemLabel.has(c.index)
      && (Math.abs(c.y0 - s.lines[0]) < 0.5 * sp || Math.abs(c.y1 - s.lines[4]) < 0.5 * sp))
      || (c.h >= 3.5 * sp && c.h <= 4.6 * sp && c.w >= 1.4 * sp && Math.abs(c.y0 - s.lines[0]) < 0.4 * sp && Math.abs(c.y1 - s.lines[4]) < 0.4 * sp));
    if (figures.length) {
      s.time = figures;
      for (const c of figures) used.add(c.index);
      s.headerEnd = Math.max(x, ...figures.map((c) => c.x1));
    }
  }

  // --- Systems: staffs joined by a line on the left (a piano or choir staff) --
  const systems = [];
  for (const s of staffs) {
    const prev = systems.length ? systems[systems.length - 1] : null;
    const above = prev && prev.staffs[prev.staffs.length - 1];
    let joined = false;
    if (above && Math.abs(above.x0 - s.x0) < 2 * s.space) {
      const xs = [above.x0, s.x0, ...above.bars.filter((b) => s.bars.some((c) => Math.abs(c - b) < 3))];
      for (const bx of xs) {
        for (let x = Math.round(bx) - 3; x <= bx + 3 && !joined; x++) {
          let n = 0;
          const y0 = Math.round(above.lines[4]), y1 = Math.round(s.lines[0]);
          for (let y = y0; y <= y1; y++) n += ink[y * W + x];
          if (n >= 0.95 * (y1 - y0 + 1)) joined = true;
        }
        if (joined) break;
      }
    }
    if (joined) prev.staffs.push(s); else systems.push({ staffs: [s] });
  }
  // A key signature missed on one line (a smudge, a broken flat) is taken
  // from the other lines of the page, which nearly always share it.
  const counts = new Map();
  for (const s of staffs) if (s.fifths) counts.set(s.fifths, (counts.get(s.fifths) || 0) + 1);
  const pageKey = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (pageKey) for (const s of staffs) if (!s.fifths) s.fifths = pageKey[0];
  for (const sys of systems) {
    // Staffs of a system that lost their clef take the usual one for their place.
    sys.staffs.forEach((s, i) => { if (!s.clef) s.clef = sys.staffs.length > 1 && i === sys.staffs.length - 1 ? 'bass' : 'treble'; });
    const fifths = sys.staffs.map((s) => s.fifths);
    const most = fifths.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
    for (const s of sys.staffs) s.fifths = most;
    // Bar lines: any found on one staff of the system count for all of them.
    const all = [];
    for (const s of sys.staffs) for (const b of s.bars) if (!all.some((a) => Math.abs(a - b) < s.space)) all.push(b);
    sys.bars = all.sort((a, b) => a - b);
    sys.x0 = Math.min(...sys.staffs.map((s) => s.x0));
    sys.x1 = Math.max(...sys.staffs.map((s) => s.x1));
  }

  // --- Pitches, accidentals, durations ---------------------------------------
  const notes = [];
  for (const head of heads) {
    const s = head.staff;
    if (head.cx <= s.headerEnd) continue;
    const sp = s.space;
    const step = Math.round((s.lines[4] - head.cy) / (sp / 2));
    const number = BOTTOM_LINE[s.clef] + step;
    const letter = ((number % 7) + 7) % 7;
    const octave = Math.floor(number / 7);
    // An accidental just to the left, level with the head.
    let accidental = null;
    for (const c of compsIn(s, head.x0 - 1.8 * sp, head.x0 - 1)) {
      if (used.has(c.index) || c.x1 >= head.x0 || head.x0 - c.x1 > 1.4 * sp || c.y0 > head.cy || c.y1 < head.cy) continue;
      const k = accidentalKind(c, sp);
      // A sharp or natural is centred on its note; a flat's note is in its bulb.
      const at = k === 'flat' ? c.y1 - 0.55 * sp : (c.y0 + c.y1) / 2;
      if (k && Math.abs(at - head.cy) < 0.5 * sp) { accidental = k; break; }
    }
    let duration;
    if (head.hollow) duration = head.stem ? 2 : 4;
    else duration = 1 / 2 ** beamsOn(s, head.stem, head.cy);
    if (dotted(s, head)) duration *= 1.5;
    notes.push({
      x: head.cx, y: head.cy, x0: head.x0, x1: head.x1, staff: s.index, clef: s.clef, step: number, letter, octave, accidental,
      duration, hollow: head.hollow, stem: head.stem ? head.stem.dir : null,
    });
  }
  // Two heads found for the same place (a filled core inside a hollow ring) count once.
  notes.sort((a, b) => a.x - b.x || a.y - b.y);
  const unique = [];
  for (const n of notes) {
    const sp = staffs[n.staff].space;
    if (!unique.some((m) => m.staff === n.staff && Math.abs(m.x - n.x) < 0.5 * sp && Math.abs(m.y - n.y) < 0.6 * sp)) unique.push(n);
  }

  // Sharps and flats: key signature, then accidentals that last to the bar line.
  for (const sys of systems) {
    for (const s of sys.staffs) {
      const keyAlter = new Map();
      if (s.fifths > 0) for (const l of SHARP_ORDER.slice(0, s.fifths)) keyAlter.set(l, 1);
      if (s.fifths < 0) for (const l of FLAT_ORDER.slice(0, -s.fifths)) keyAlter.set(l, -1);
      let measure = -1, held = new Map();
      for (const n of unique.filter((m) => m.staff === s.index)) {
        const m = sys.bars.filter((b) => b < n.x).length;
        if (m !== measure) { measure = m; held = new Map(); }
        if (n.accidental) held.set(n.step, { sharp: 1, flat: -1, natural: 0 }[n.accidental]);
        n.alter = held.has(n.step) ? held.get(n.step) : keyAlter.get(n.letter) || 0;
        n.measure = m;
        n.midi = 12 * (n.octave + 1) + SEMITONE[n.letter] + n.alter;
        n.name = LETTERS[n.letter] + (n.alter > 0 ? '#' : n.alter < 0 ? 'b' : '');
      }
    }
  }

  // Back to the page's own (tilted) coordinates.
  for (const n of unique) n.y += n.x * slope;
  const out = staffs.map((s) => ({
    index: s.index, lines: s.lines.map((y) => y + ((s.x0 + s.x1) / 2) * slope), space: s.space, x0: s.x0, x1: s.x1,
    clef: s.clef, fifths: s.fifths, bars: s.bars, headerEnd: s.headerEnd,
  }));
  return {
    ...(debug ? { debug: { sym, width: W, height: H } } : null),
    staffs: out,
    systems: systems.map((sys) => ({ staffs: sys.staffs.map((s) => s.index), bars: sys.bars, x0: sys.x0, x1: sys.x1 })),
    notes: unique.filter((n) => n.midi != null),
    slope,
  };
}


