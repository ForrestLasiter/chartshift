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

test('lines stay inside their own column, and a title across the page stays whole', () => {
  const { img, rect } = blankPage(900, 700);
  // A title that runs across the gutter.
  drawLine(rect, 60, 30, [4, 5, 6, 6, 5, 6, 6, 5]);
  // Left column rows, and right column rows half a row lower.
  const leftRows = [], rightRows = [];
  for (let i = 0; i < 16; i++) {
    const y = 100 + i * 34;
    drawLine(rect, 60, y, [3, 3, 5, 6]);
    drawLine(rect, 520, y + 7, [5, 2, 3, 6]);
    leftRows.push(y);
    rightRows.push(y + 7);
  }
  const { pieces } = segment(img);
  const lineOf = (x, y) => pieces.find((p) => p.x >= x - 1 && p.x <= x + 1 && p.y >= y - 1 && p.y <= y + 1).line;
  for (let i = 0; i < 16; i++) {
    const left = lineOf(60, leftRows[i]), right = lineOf(520, rightRows[i]);
    assert.notEqual(left, right, `row ${i}: the two columns are separate lines`);
    const inLeft = pieces.filter((p) => p.line === left), inRight = pieces.filter((p) => p.line === right);
    assert.ok(inLeft.every((p) => p.x < 450) && inLeft.length === 17, `row ${i}: left line holds only left-column letters`);
    assert.ok(inRight.every((p) => p.x > 450) && inRight.length === 16, `row ${i}: right line holds only right-column letters`);
  }
  const title = pieces.filter((p) => p.y < 60);
  assert.equal(new Set(title.map((p) => p.line)).size, 1, 'the title is one line although it crosses the gutter');
  assert.ok(Math.max(...title.map((p) => p.x)) > 450 && Math.min(...title.map((p) => p.x)) < 100);
});

test('a single column with gaps inside its lines is not split', () => {
  const { img, rect } = blankPage(900, 400);
  for (let i = 0; i < 8; i++) {
    drawLine(rect, 60, 40 + i * 40, [1]);            // chord
    drawLine(rect, 500, 40 + i * 40, [2]);           // chord far to the right
    drawLine(rect, 60, 56 + i * 40, [3, 3, 5, 6, 2, 3, 5, 6, 4, 4, 6, 3, 5]);
  }
  const { pieces } = segment(img);
  const chordRow = pieces.filter((p) => p.y >= 39 && p.y <= 41);
  assert.equal(new Set(chordRow.map((p) => p.line)).size, 1, 'far-apart chords on one row are still one line');
});

test('pale rules and pale text are kept; the soft edges of dark letters are not', () => {
  const { img, rect } = blankPage(600, 300);
  rect(40, 60, 520, 2, 204);                       // a light grey rule
  for (let i = 0; i < 6; i++) rect(440 + i * 14, 260, 9, 12, 190);   // pale footer text
  drawLine(rect, 40, 100, [4, 3]);                 // normal dark text…
  for (let i = 0; i < 4; i++) {                    // …with a soft grey edge around each letter
    const x = 40 + i * 11;
    rect(x - 1, 99, 10, 1, 200); rect(x - 1, 112, 10, 1, 200);
  }
  const before = segment(img, { faint: false }).pieces;
  const { pieces } = segment(img);
  const rule = pieces.find((p) => p.w > 500);
  assert.ok(rule && rule.h <= 4, 'the rule is a piece');
  assert.equal(pieces.filter((p) => p.y >= 255).length, 6, 'each pale footer letter is a piece');
  assert.equal(pieces.filter((p) => p.y > 90 && p.y < 120).length, 7, 'dark letters are unchanged: no extra pieces from their edges');
  assert.equal(before.filter((p) => p.w > 500).length + before.filter((p) => p.y >= 255).length, 0, 'with faint off, pale marks are dropped as before');
});
