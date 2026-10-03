import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segment } from '../src/lib/segment.js';

function blankPage(w, h) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  const rect = (x, y, rw, rh, c = 0) => {
    for (let yy = y; yy < y + rh; yy++) for (let xx = x; xx < x + rw; xx++) {
      const p = (yy * w + xx) * 4;
      data[p] = data[p + 1] = data[p + 2] = c;
    }
  };
  return { img: { data, width: w, height: h }, rect };
}

// Draws "words" of 8x12 letter boxes: 3px between letters, 12px between words.
function drawLine(rect, x, y, wordLengths) {
  for (const len of wordLengths) {
    for (let i = 0; i < len; i++) { rect(x, y, 8, 12); x += 11; }
    x += 9;
  }
}

test('blank page has no pieces', () => {
  const { img } = blankPage(100, 100);
  assert.equal(segment(img).pieces.length, 0);
});

test('letters group into words, lines and blocks', () => {
  const { img, rect } = blankPage(400, 300);
  drawLine(rect, 20, 20, [3, 2]);   // verse 1, line 1
  drawLine(rect, 20, 40, [4]);      // verse 1, line 2
  drawLine(rect, 20, 120, [2, 2]);  // verse 2 after a blank gap
  const { pieces } = segment(img);
  assert.equal(pieces.length, 13);
  assert.equal(new Set(pieces.map((p) => p.line)).size, 3);
  assert.equal(new Set(pieces.map((p) => p.word)).size, 5);
  assert.equal(new Set(pieces.map((p) => p.block)).size, 2);
});

test('a dot above a stem merges into one letter', () => {
  const { img, rect } = blankPage(200, 100);
  drawLine(rect, 20, 30, [2]);
  rect(60, 30, 3, 12);  // i stem
  rect(60, 24, 3, 3);   // i dot
  const { pieces } = segment(img);
  assert.equal(pieces.length, 3);
  const i = pieces.find((p) => p.x >= 59);
  assert.ok(i.h >= 18, 'dot and stem share one piece');
});

test('a wide staff is a container and owns what sits inside it', () => {
  const { img, rect } = blankPage(400, 200);
  for (let k = 0; k < 5; k++) rect(20, 50 + k * 10, 360, 1);
  rect(20, 50, 1, 41); rect(379, 50, 1, 41); // barlines join the staff lines
  rect(100, 63, 6, 6);                       // a note head between lines
  drawLine(rect, 20, 150, [3]);
  const { pieces } = segment(img);
  const staff = pieces[0];
  assert.ok(staff.w >= 360);
  const note = pieces.find((p) => p.w < 12 && p.y > 55 && p.y < 75);
  assert.equal(note.block, staff.block);
  const text = pieces.filter((p) => p.y > 140);
  assert.equal(text.length, 3);
  assert.notEqual(text[0].block, staff.block);
});

test('sprites carry only their own ink, with paper made transparent', () => {
  const { img, rect } = blankPage(100, 60);
  rect(10, 10, 8, 12, 0);
  rect(30, 10, 8, 12, 0);
  const { pieces, atlases } = segment(img);
  const p = pieces[0];
  const a = atlases[p.atlas];
  const alphaAt = (x, y) => a.data[((p.sy + y) * a.width + p.sx + x) * 4 + 3];
  assert.equal(alphaAt(0, 0), 255);
  assert.equal(a.data[3], 0, 'atlas padding is transparent');
});
