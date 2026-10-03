// Text box fonts and measurement. Sizes are in points (1pt = 1 page unit).
export const FONTS = [
  { label: 'Arial', css: 'Arial, Helvetica, sans-serif' },
  { label: 'Courier New (tab spacing)', css: '"Courier New", Courier, monospace' },
  { label: 'Consolas (tab spacing)', css: 'Consolas, "Courier New", monospace' },
  { label: 'Times New Roman', css: '"Times New Roman", Times, serif' },
  { label: 'Georgia', css: 'Georgia, serif' },
  { label: 'Verdana', css: 'Verdana, Geneva, sans-serif' },
];

export const LINE_HEIGHT = 1.2;

export const DEFAULT_TEXT_STYLE = { font: FONTS[0].css, size: 12, bold: false, italic: false, color: '#000000' };

export function fontCss(style, scale = 1) {
  return `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${style.size * scale}px ${style.font}`;
}

let measureCtx = null;

export function measureText(piece) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = fontCss(piece);
  const lines = piece.text.split('\n');
  let w = 0;
  for (const line of lines) w = Math.max(w, measureCtx.measureText(line).width);
  return { w: Math.max(w, piece.size * 0.5), h: lines.length * piece.size * LINE_HEIGHT };
}

const metricsCache = new Map();

// Cap height and baseline position of a font, as fractions of its size.
function fontMetrics(style) {
  const key = fontCss({ ...style, size: 100 });
  let m = metricsCache.get(key);
  if (!m) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    measureCtx.font = key;
    measureCtx.textBaseline = 'top';
    const box = measureCtx.measureText('H');
    m = { base: box.actualBoundingBoxDescent / 100, cap: (box.actualBoundingBoxDescent + box.actualBoundingBoxAscent) / 100 };
    metricsCache.set(key, m);
  }
  return m;
}

/** Font size whose capital letters are `capHeight` points tall. */
export const sizeForCapHeight = (style, capHeight) => capHeight / fontMetrics(style).cap;

/** Distance from a text box's top edge down to the baseline of its first line. */
export const baselineOffset = (style) => style.size * ((LINE_HEIGHT - 1) / 2 + fontMetrics(style).base);
