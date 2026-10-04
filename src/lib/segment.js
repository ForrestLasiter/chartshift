// Page segmentation: turns a rendered page (RGBA pixels) into movable pieces.
//
// Every connected blob of ink becomes a sprite with a transparent background,
// packed into an atlas. Sprites are grouped into letters, words, lines and
// blocks by geometry alone, so this works the same for scans and digital PDFs.
// Pure function, no DOM - runs in Node for tests.

const MAX_ATLAS_HEIGHT = 8192;

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
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; threshold = i; }
  }
  return threshold + 1;
}

function median(values, fallback) {
  if (!values.length) return fallback;
  const s = values.slice().sort((a, b) => a - b);
  return s[s.length >> 1];
}

// Typical glyph height, weighted by size so that rows of dashes or specks
// don't drag the estimate down to nothing.
function typicalHeight(comps, pageWidth) {
  const glyphs = comps.filter((c) => c.w <= 0.25 * pageWidth).sort((a, b) => a.h - b.h);
  let total = 0;
  for (const c of glyphs) total += c.w * c.h;
  let acc = 0;
  for (const c of glyphs) {
    acc += c.w * c.h;
    if (acc >= total / 2) return c.h;
  }
  return 10;
}

// Groups items that share a text row. Tall-ish items establish the rows, then
// small marks (dots, commas, dashes) attach to the nearest row.
function clusterLines(items, hm) {
  const lines = [];
  const newLine = (c) => {
    const L = { x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1, items: [c] };
    lines.push(L);
    return L;
  };
  const placeByOverlap = (c) => {
    let bestLine = null, bestOv = 0;
    for (const L of lines) {
      const ov = Math.min(c.y1, L.y1) - Math.max(c.y0, L.y0) + 1;
      if (ov <= 0) continue;
      const lh = L.y1 - L.y0 + 1;
      if (ov / Math.min(c.h, lh) >= 0.5 && ov > bestOv) { bestOv = ov; bestLine = L; }
    }
    return bestLine;
  };
  const addTo = (L, c, growBand) => {
    L.items.push(c);
    L.x0 = Math.min(L.x0, c.x0);
    L.x1 = Math.max(L.x1, c.x1);
    if (growBand && c.h <= 1.8 * (L.y1 - L.y0 + 1)) {
      L.y0 = Math.min(L.y0, c.y0);
      L.y1 = Math.max(L.y1, c.y1);
    }
  };

  const anchors = items.filter((c) => c.h >= 0.4 * hm).sort((a, b) => a.y0 - b.y0);
  const smalls = items.filter((c) => c.h < 0.4 * hm);
  for (const c of anchors) {
    const L = placeByOverlap(c);
    if (L) addTo(L, c, true); else newLine(c);
  }

  const anchorLines = lines.length;
  const leftovers = [];
  for (const c of smalls) {
    const cy = (c.y0 + c.y1) / 2;
    let bestLine = null, bestScore = Infinity;
    for (let i = 0; i < anchorLines; i++) {
      const L = lines[i];
      const lh = L.y1 - L.y0 + 1;
      if (cy < L.y0 - 0.6 * lh || cy > L.y1 + 0.6 * lh) continue;
      if (c.x1 < L.x0 - 3 * hm || c.x0 > L.x1 + 3 * hm) continue;
      const outside = Math.max(0, L.y0 - cy, cy - L.y1);
      const score = outside * 1000 + Math.abs(cy - (L.y0 + L.y1) / 2);
      if (score < bestScore) { bestScore = score; bestLine = L; }
    }
    if (bestLine) addTo(bestLine, c, false); else leftovers.push(c);
  }
  // Rows made only of small marks (e.g. a row of dashes) cluster among themselves.
  leftovers.sort((a, b) => a.y0 - b.y0);
  const firstLeftoverLine = lines.length;
  for (const c of leftovers) {
    let target = null;
    for (let i = firstLeftoverLine; i < lines.length; i++) {
      const L = lines[i];
      const ov = Math.min(c.y1, L.y1) - Math.max(c.y0, L.y0) + 1;
      if (ov > 0 && ov / Math.min(c.h, L.y1 - L.y0 + 1) >= 0.5) { target = L; break; }
    }
    if (target) addTo(target, c, true); else newLine(c);
  }
  return lines;
}

/**
 * Labels the connected regions (8-connectivity, two-pass union-find) of the
 * pixels set in `mask`. Writes 1-based component numbers into `labels` and
 * appends { x0, y0, x1, y1, area } to `comps`; numbering continues from the
 * components already in `comps`, so it can be called for a second mask.
 */
function labelComponents(mask, W, H, labels, comps) {
  const base = comps.length;
  const local = new Int32Array(W * H);
  let parent = new Int32Array(1 << 16);
  let next = 1;
  const find = (x) => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  };
  for (let y = 0, i = 0; y < H; y++) {
    for (let x = 0; x < W; x++, i++) {
      if (!mask[i]) continue;
      let l = x > 0 ? local[i - 1] : 0;
      if (y > 0) {
        const up = i - W;
        for (let k = (x > 0 ? -1 : 0); k <= (x < W - 1 ? 1 : 0); k++) {
          const n = local[up + k];
          if (!n) continue;
          if (!l) { l = n; continue; }
          if (n !== l) {
            const ra = find(l), rb = find(n);
            if (ra !== rb) { if (ra < rb) parent[rb] = ra; else parent[ra] = rb; }
          }
        }
      }
      if (!l) {
        if (next >= parent.length) {
          const grown = new Int32Array(parent.length * 2);
          grown.set(parent);
          parent = grown;
        }
        l = next;
        parent[next] = next;
        next++;
      }
      local[i] = l;
    }
  }
  const compOf = new Int32Array(next);
  for (let y = 0, i = 0; y < H; y++) {
    for (let x = 0; x < W; x++, i++) {
      const l = local[i];
      if (!l) continue;
      const r = find(l);
      let ci = compOf[r];
      if (!ci) {
        comps.push({ x0: x, y0: y, x1: x, y1: y, area: 0 });
        ci = compOf[r] = comps.length - base;
      }
      const c = comps[base + ci - 1];
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y > c.y1) c.y1 = y;
      c.area++;
      labels[i] = base + ci;
    }
  }
}

// A copy of `mask` grown by `radius` pixels in every direction.
function dilated(mask, W, H, radius) {
  const rows = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const o = y * W;
    let reach = -1;
    for (let x = 0; x < W; x++) { if (mask[o + x]) reach = x + radius; if (x <= reach) rows[o + x] = 1; }
    reach = W;
    for (let x = W - 1; x >= 0; x--) { if (mask[o + x]) reach = x - radius; if (x >= reach) rows[o + x] = 1; }
  }
  const out = new Uint8Array(W * H);
  for (let x = 0; x < W; x++) {
    let reach = -1;
    for (let y = 0; y < H; y++) { if (rows[y * W + x]) reach = y + radius; if (y <= reach) out[y * W + x] = 1; }
    reach = H;
    for (let y = H - 1; y >= 0; y--) { if (rows[y * W + x]) reach = y - radius; if (y >= reach) out[y * W + x] = 1; }
  }
  return out;
}

// Finds the empty vertical strips between columns of text. A strip counts
// when almost nothing crosses it (a title running across the page is allowed),
// it is clearly wider than a word space, and there is real content on both
// sides. Returns the x position of the middle of each strip.
function findGutters(items, pageWidth, hm) {
  if (items.length < 12) return [];
  const diff = new Float64Array(pageWidth + 2);
  for (const c of items) { diff[c.x0] += c.h; diff[c.x1 + 1] -= c.h; }
  const cover = new Float64Array(pageWidth + 1);
  let acc = 0, peak = 0, first = -1, last = -1;
  for (let x = 0; x <= pageWidth; x++) {
    acc += diff[x];
    cover[x] = acc;
    if (acc > peak) peak = acc;
    if (acc > 0.5) { if (first < 0) first = x; last = x; }
  }
  const limit = peak * 0.08;
  const minWidth = Math.max(3.5 * hm, 0.02 * pageWidth);
  const gutters = [];
  let start = -1;
  for (let x = first; x <= last + 1; x++) {
    const empty = x <= last && cover[x] <= limit;
    if (empty && start < 0) start = x;
    if (!empty && start >= 0) {
      if (x - start >= minWidth) {
        const middle = (start + x) / 2;
        let left = 0, right = 0;
        for (const c of items) { if ((c.x0 + c.x1) / 2 < middle) left++; else right++; }
        if (left >= items.length * 0.15 && right >= items.length * 0.15) gutters.push(middle);
      }
      start = -1;
    }
  }
  return gutters;
}

// Lines for free-standing text. On a page set in columns, rows of different
// columns rarely sit at exactly the same height, so each column gets its own
// lines; a line that genuinely runs across a gutter (a title) is joined up.
function linesInColumns(items, hm, pageWidth) {
  const gutters = findGutters(items, pageWidth, hm);
  if (!gutters.length) return clusterLines(items, hm);
  const groups = Array.from({ length: gutters.length + 1 }, () => []);
  for (const c of items) {
    const cx = (c.x0 + c.x1) / 2;
    let k = 0;
    while (k < gutters.length && cx > gutters[k]) k++;
    groups[k].push(c);
  }
  const lines = [];
  groups.forEach((group, k) => {
    for (const R of clusterLines(group, hm)) {
      const L = k === 0 ? null : lines.find((l) => {
        if (l.column !== k - 1) return false;
        const overlap = Math.min(l.y1, R.y1) - Math.max(l.y0, R.y0) + 1;
        return overlap >= 0.6 * Math.min(l.y1 - l.y0 + 1, R.y1 - R.y0 + 1) && R.x0 - l.x1 < 1.5 * hm;
      });
      if (L) {
        L.items.push(...R.items);
        L.x1 = Math.max(L.x1, R.x1);
        L.y0 = Math.min(L.y0, R.y0);
        L.y1 = Math.max(L.y1, R.y1);
        L.column = k;
      } else {
        R.column = k;
        lines.push(R);
      }
    }
  });
  return lines;
}

/**
 * @param {{data: Uint8ClampedArray, width: number, height: number}} img
 * @returns {{atlases: {width:number,height:number,data:Uint8ClampedArray}[], pieces: object[], stats: object}}
 *   pieces are in source pixels: {x,y,w,h, atlas,sx,sy, word,line,block, frame?, contained?}
 *   `speckScale` raises the size below which stray dots are dropped (for scans).
 *   `faint` keeps pale marks (grey rules, footers); turn it off for photographed
 *   or unevenly lit scans, where pale patches are shadows rather than content.
 */
export function segment(img, { speckScale = 1, faint = true } = {}) {
  const { width: W, height: H, data } = img;
  const N = W * H;

  // 1. Darkness channel (min of RGB, so coloured ink counts as ink) + histogram.
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
  const empty = { atlases: [], pieces: [], stats: { components: 0, lines: 0, blocks: 0 } };
  if (T < 1) return empty;

  let inkCount = 0;
  for (let i = 0; i < T; i++) inkCount += hist[i];
  if (!inkCount) return empty;
  let inkLo = 0;
  for (let acc = 0; inkLo < T; inkLo++) { acc += hist[inkLo]; if (acc >= inkCount * 0.25) break; }
  inkLo = Math.min(inkLo, bg - 10);

  // 2. Connected components of solid ink.
  const labels = new Int32Array(N);
  const comps = [];
  const solid = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (v[i] < T) solid[i] = 1;
  labelComponents(solid, W, H, labels, comps);

  // 2b. Faint marks: light grey rules, footers and pale text that are clearly
  //     darker than the paper but lighter than the ink threshold. They are
  //     looked for only away from solid ink, so the soft edges of letters
  //     never turn into pieces of their own.
  const faintLevel = bg - 40;
  if (faint && faintLevel > T + 16) {
    const near = dilated(solid, W, H, 3);
    const pale = new Uint8Array(N);
    let any = false;
    for (let i = 0; i < N; i++) if (!near[i] && v[i] < faintLevel) { pale[i] = 1; any = true; }
    if (any) {
      const firstFaint = comps.length;
      labelComponents(pale, W, H, labels, comps);
      for (let i = firstFaint; i < comps.length; i++) comps[i].faint = true;
    }
  }

  // 3. Drop specks, measure the typical glyph height.
  const minArea = Math.max(2, Math.round((5 * speckScale * N) / (2550 * 3300)));
  const kept = [];
  for (let i = 0; i < comps.length; i++) {
    const c = comps[i];
    c.index = i;
    c.w = c.x1 - c.x0 + 1;
    c.h = c.y1 - c.y0 + 1;
    if (c.area >= (c.faint ? 6 * minArea : minArea)) kept.push(c);
  }
  if (!kept.length) return empty;
  const hm = typicalHeight(kept, W);

  // 4. Containers: staffs, tab systems, rules, boxes. They move as one block
  //    together with whatever sits inside them.
  const containers = [], normal = [];
  for (const c of kept) {
    if (c.w > 0.25 * W || c.h > 6 * hm) {
      c.frame = c.w * c.h > 0.4 * N;
      containers.push(c);
    } else normal.push(c);
  }
  const membersOf = new Map();
  membersOf.set(null, []);
  for (const c of normal) {
    const cx = (c.x0 + c.x1) / 2, cy = (c.y0 + c.y1) / 2;
    let host = null;
    for (const k of containers) {
      if (k.frame) continue;
      if (cx < k.x0 || cx > k.x1 || cy < k.y0 || cy > k.y1) continue;
      if (!host || k.w * k.h < host.w * host.h) host = k;
    }
    if (!membersOf.has(host)) membersOf.set(host, []);
    membersOf.get(host).push(c);
  }

  // 5. Lines -> letters -> words, per container group.
  let lineId = 0, wordId = 0, blockId = 0;
  const letters = [];
  const freeLines = [];
  for (const k of containers) {
    k.block = ++blockId;
    letters.push({ comps: [k], x0: k.x0, y0: k.y0, x1: k.x1, y1: k.y1, line: ++lineId, word: ++wordId, block: k.block, frame: k.frame, container: true });
  }
  for (const [host, members] of membersOf) {
    for (const L of (host ? clusterLines(members, hm) : linesInColumns(members, hm, W))) {
      L.id = ++lineId;
      L.items.sort((a, b) => a.x0 - b.x0);
      const lh = median(L.items.filter((c) => c.h >= 0.4 * hm).map((c) => c.h), hm);
      const lineLetters = [];
      let cur = null;
      for (const c of L.items) {
        if (cur) {
          const ov = Math.min(cur.x1, c.x1) - Math.max(cur.x0, c.x0) + 1;
          const cw = cur.x1 - cur.x0 + 1;
          if (ov >= 0.5 * Math.min(cw, c.w) && Math.max(cw, c.w) <= 4 * lh) {
            cur.comps.push(c);
            cur.x1 = Math.max(cur.x1, c.x1);
            cur.y0 = Math.min(cur.y0, c.y0);
            cur.y1 = Math.max(cur.y1, c.y1);
            continue;
          }
        }
        cur = { comps: [c], x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, line: L.id };
        lineLetters.push(cur);
      }
      // Word gap: wider than the usual letter gap on this line. Measuring the
      // line's own letter gaps keeps evenly spaced (typewriter) fonts together.
      const letterGaps = [];
      for (let i = 1; i < lineLetters.length; i++) {
        const gap = lineLetters[i].x0 - lineLetters[i - 1].x1 - 1;
        if (gap < 0.7 * lh) letterGaps.push(Math.max(gap, 0));
      }
      const gapLimit = Math.min(0.7 * lh, Math.max(0.32 * lh, 1.7 * median(letterGaps, 0)));
      let prev = null;
      for (const t of lineLetters) {
        if (!prev || t.x0 - prev.x1 - 1 > gapLimit) wordId++;
        t.word = wordId;
        prev = t;
      }
      L.letters = lineLetters;
      if (host) for (const t of lineLetters) { t.block = host.block; t.contained = true; }
      else freeLines.push(L);
      letters.push(...lineLetters);
    }
  }

  // 6. Blocks: free lines separated by less than a blank line stick together.
  freeLines.sort((a, b) => a.y0 - b.y0);
  const lineH = median(freeLines.map((L) => L.y1 - L.y0 + 1), hm);
  const blocks = [];
  for (const L of freeLines) {
    let target = null;
    for (let i = blocks.length - 1; i >= 0; i--) {
      const B = blocks[i];
      if (L.y0 - B.y1 >= 1.2 * lineH) continue;
      if (L.x1 < B.x0 - 2 * hm || L.x0 > B.x1 + 2 * hm) continue;
      target = B;
      break;
    }
    if (!target) {
      target = { id: ++blockId, x0: L.x0, x1: L.x1, y0: L.y0, y1: L.y1 };
      blocks.push(target);
    } else {
      target.x0 = Math.min(target.x0, L.x0);
      target.x1 = Math.max(target.x1, L.x1);
      target.y1 = Math.max(target.y1, L.y1);
    }
    for (const t of L.letters) t.block = target.id;
  }

  // 7. Give every pixel an owner, then grow owners by one pixel so the soft
  //    anti-aliased edge travels with its glyph.
  const pieceOf = new Int32Array(comps.length + 1);
  letters.forEach((t, i) => { for (const c of t.comps) pieceOf[c.index + 1] = i + 1; });
  for (let i = 0; i < N; i++) if (labels[i]) labels[i] = pieceOf[labels[i]];
  const owner = labels.slice();
  const edge = bg - 6;
  for (let y = 0, i = 0; y < H; y++) {
    for (let x = 0; x < W; x++, i++) {
      if (labels[i] || v[i] >= edge) continue;
      let o = 0;
      for (let dy = -1; dy <= 1 && !o; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          o = labels[yy * W + xx];
          if (o) break;
        }
      }
      if (!o) continue;
      owner[i] = o;
      const t = letters[o - 1];
      if (x < t.x0) t.x0 = x;
      if (x > t.x1) t.x1 = x;
      if (y < t.y0) t.y0 = y;
      if (y > t.y1) t.y1 = y;
    }
  }

  // 8. Shelf-pack sprites into atlases.
  const order = letters.map((_, i) => i).sort((a, b) =>
    (letters[b].y1 - letters[b].y0) - (letters[a].y1 - letters[a].y0));
  let atlasW = W;
  for (const t of letters) atlasW = Math.max(atlasW, t.x1 - t.x0 + 3);
  const atlasHeights = [];
  let ax = 1, ay = 1, shelf = 0, atlasIndex = 0;
  for (const i of order) {
    const t = letters[i];
    const w = t.x1 - t.x0 + 1, h = t.y1 - t.y0 + 1;
    if (ax + w + 1 > atlasW) { ax = 1; ay += shelf + 1; shelf = 0; }
    if (ay + h + 1 > MAX_ATLAS_HEIGHT && ay > 1) {
      atlasHeights[atlasIndex++] = ay;
      ax = 1; ay = 1; shelf = 0;
    }
    t.atlas = atlasIndex; t.sx = ax; t.sy = ay;
    ax += w + 1;
    if (h > shelf) shelf = h;
  }
  atlasHeights[atlasIndex] = ay + shelf + 1;
  const atlases = atlasHeights.map((h) => ({ width: atlasW, height: h, data: new Uint8ClampedArray(atlasW * h * 4) }));

  // 9. Copy ink into the atlas, turning paper into transparency.
  const range = bg - inkLo;
  for (let n = 0; n < letters.length; n++) {
    const t = letters[n];
    const out = atlases[t.atlas];
    const id = n + 1;
    for (let y = t.y0; y <= t.y1; y++) {
      let i = y * W + t.x0;
      let o = ((t.sy + y - t.y0) * out.width + t.sx) * 4;
      for (let x = t.x0; x <= t.x1; x++, i++, o += 4) {
        if (owner[i] !== id) continue;
        let a = (bg - v[i]) / range;
        if (a <= 0) continue;
        if (a > 1) a = 1;
        const p = i * 4, k = (1 - a) * bg;
        out.data[o] = (data[p] - k) / a;
        out.data[o + 1] = (data[p + 1] - k) / a;
        out.data[o + 2] = (data[p + 2] - k) / a;
        out.data[o + 3] = a * 255;
      }
    }
  }

  // Containers first so letters inside a staff draw (and hit-test) on top.
  const pieces = letters
    .map((t, i) => ({
      x: t.x0, y: t.y0, w: t.x1 - t.x0 + 1, h: t.y1 - t.y0 + 1,
      atlas: t.atlas, sx: t.sx, sy: t.sy,
      word: t.word, line: t.line, block: t.block,
      ...(t.frame ? { frame: true } : null),
      ...(t.contained ? { contained: true } : null),
      _container: !!t.container, _order: i,
    }))
    .sort((a, b) => (b._container - a._container) || (a._order - b._order))
    .map(({ _container, _order, ...p }) => p);

  return { atlases, pieces, stats: { components: kept.length, lines: lineId, blocks: blockId, glyphHeight: hm } };
}
