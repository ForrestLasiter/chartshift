// The colour tokens must keep WCAG 2.1 AA contrast: 4.5:1 for text, 3:1 for
// the borders and marks that identify a control or carry meaning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const render = readFileSync(new URL('../src/lib/render.js', import.meta.url), 'utf8');
const token = (name) => {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(match, `token --${name} exists`);
  return match[1];
};
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const WHITE = '#ffffff';

test('text colours meet 4.5:1 on every surface they are used on', () => {
  const pairs = [
    ['text', 'surface'], ['text', 'surface-2'], ['text', 'surface-3'], ['text', 'desk'], ['text', 'accent-soft'],
    ['text-2', 'surface'], ['text-2', 'surface-2'], ['text-2', 'surface-3'], ['text-2', 'desk'], ['text-2', 'accent-soft'], ['text-2', 'line'],
    ['accent-hover', 'surface'], ['accent-hover', 'accent-soft'], ['accent-hover', 'surface-2'],
    ['danger', 'surface'], ['danger', 'danger-soft'], ['danger', 'surface-2'],
  ];
  for (const [fg, bg] of pairs) assert.ok(ratio(token(fg), token(bg)) >= 4.5, `${fg} on ${bg}: ${ratio(token(fg), token(bg)).toFixed(2)}`);
});

test('white text is readable on filled buttons and section tags', () => {
  for (const name of ['accent', 'accent-hover', 'accent-press', 'verse', 'chorus', 'bridge', 'other']) {
    assert.ok(ratio(WHITE, token(name)) >= 4.5, `white on ${name}: ${ratio(WHITE, token(name)).toFixed(2)}`);
  }
});

test('control borders, focus rings and state marks meet 3:1', () => {
  for (const [fg, bg] of [['control-line', 'surface'], ['control-line', 'surface-2'], ['accent', 'surface'], ['accent', 'surface-2'], ['accent', 'surface-3'], ['accent', 'desk'], ['accent', 'accent-soft'], ['bridge', 'surface']]) {
    assert.ok(ratio(token(fg), token(bg)) >= 3, `${fg} on ${bg}: ${ratio(token(fg), token(bg)).toFixed(2)}`);
  }
});

test('colours drawn on the page match the tokens and show on white paper', () => {
  for (const name of ['verse', 'chorus', 'bridge', 'other', 'accent']) assert.ok(render.includes(token(name)), `render.js uses --${name}`);
  for (const name of ['verse', 'chorus', 'bridge', 'other', 'accent']) assert.ok(ratio(token(name), WHITE) >= 3);
});
