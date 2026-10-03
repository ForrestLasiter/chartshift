// Scan cleanup: even out lighting / whiten the paper, and measure page tilt.
// Pure functions on RGBA pixels, no DOM.

const TILE = 48;

/**
 * Evens out the background of a scan so paper becomes white, in place.
 * Returns false (and changes nothing) when the page is already clean.
 */
export function flattenBackground(img) {
  const { width: W, height: H, data } = img;
  const gw = Math.ceil(W / TILE), gh = Math.ceil(H / TILE);
  const grid = new Float32Array(gw * gh);
  const hist = new Uint32Array(256);
  let lowest = 255;
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      hist.fill(0);
      const x1 = Math.min(W, (gx + 1) * TILE), y1 = Math.min(H, (gy + 1) * TILE);
      let count = 0;
      for (let y = gy * TILE; y < y1; y += 2) {
        for (let x = gx * TILE, p = (y * W + x) * 4; x < x1; x += 2, p += 8) {
          hist[Math.min(data[p], data[p + 1], data[p + 2])]++;
          count++;
        }
      }
      // Paper level: the brightness that 85% of the tile sits below.
      let level = 255;
      for (let acc = 0; level > 0; level--) { acc += hist[level]; if (acc >= count * 0.15) break; }
      grid[gy * gw + gx] = level;
      if (level < lowest) lowest = level;
    }
  }
  if (lowest >= 246) return false;

  // Tiles covered by something dark (a photo, a filled box) are not paper.
  const sorted = Float32Array.from(grid).sort();
  const typical = sorted[sorted.length >> 1];
  for (let i = 0; i < grid.length; i++) if (grid[i] < typical * 0.6) grid[i] = typical;
  const smooth = new Float32Array(grid.length);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = gy + dy, xx = gx + dx;
        if (yy < 0 || yy >= gh || xx < 0 || xx >= gw) continue;
        sum += grid[yy * gw + xx];
        n++;
      }
      smooth[gy * gw + gx] = sum / n;
    }
  }

  for (let y = 0, p = 0; y < H; y++) {
    const fy = Math.min(gh - 1, Math.max(0, y / TILE - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(gh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < W; x++, p += 4) {
      const fx = Math.min(gw - 1, Math.max(0, x / TILE - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(gw - 1, x0 + 1), tx = fx - x0;
      const top = smooth[y0 * gw + x0] * (1 - tx) + smooth[y0 * gw + x1] * tx;
      const bottom = smooth[y1 * gw + x0] * (1 - tx) + smooth[y1 * gw + x1] * tx;
      // Slightly over-correct so paper grain lands on pure white.
      const gain = 255 / ((top * (1 - ty) + bottom * ty) * 0.96);
      data[p] = data[p] * gain;
      data[p + 1] = data[p + 1] * gain;
      data[p + 2] = data[p + 2] * gain;
    }
  }
  return true;
}

/**
 * How far the page is tilted. Returns the rotation in degrees (positive =
 * clockwise) that straightens it, or 0 when it is already straight.
 * Text rows and staff lines pile up into sharp peaks only at the right angle.
 */
export function estimateSkew(img) {
  const { width: W, height: H, data } = img;
  const step = Math.max(1, Math.round(W / 700));
  const xs = [], ys = [];
  for (let y = 0; y < H; y += step) {
    for (let x = 0, p = y * W * 4; x < W; x += step, p += step * 4) {
      if (Math.min(data[p], data[p + 1], data[p + 2]) < 150) { xs.push(x / step); ys.push(y / step); }
    }
  }
  if (xs.length < 200) return 0;
  const rows = Math.ceil(H / step), cols = Math.ceil(W / step);
  const size = rows + cols;
  const bins = new Float64Array(size * 2);
  const score = (degrees) => {
    const a = (degrees * Math.PI) / 180, sin = Math.sin(a), cos = Math.cos(a);
    bins.fill(0);
    for (let i = 0; i < xs.length; i++) bins[Math.round(xs[i] * sin + ys[i] * cos) + size]++;
    let total = 0;
    for (let i = 0; i < bins.length; i++) total += bins[i] * bins[i];
    return total;
  };
  const flat = score(0);
  let best = 0, bestScore = flat;
  for (let d = -6; d <= 6; d += 0.5) {
    const s = score(d);
    if (s > bestScore) { bestScore = s; best = d; }
  }
  const coarse = best;
  for (let d = coarse - 0.4; d <= coarse + 0.4; d += 0.1) {
    const s = score(d);
    if (s > bestScore) { bestScore = s; best = d; }
  }
  if (Math.abs(best) < 0.15 || bestScore < flat * 1.08) return 0;
  return Math.round(best * 10) / 10;
}
