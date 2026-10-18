// Test helper: engraves a tune with Verovio and turns it into page pixels,
// together with the notes that are really on the page (read from Verovio's
// own MEI), so the music reader can be checked against the truth.
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import { Resvg } from '@resvg/resvg-js';

let toolkit = null;
async function verovio() {
  if (!toolkit) toolkit = new VerovioToolkit(await createVerovioModule());
  return toolkit;
}

const STEP = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const ALTER = { s: 1, f: -1, n: 0, ss: 2, ff: -2 };

// Notes from MEI in document order: { staff, measure, midi }.
function notesOf(mei) {
  const notes = [];
  let measure = 0, staff = 0;
  const re = /<measure\b|<staff\b[^>]*\bn="(\d+)"|<note\b([^>]*?)(\/>|>)([\s\S]*?)(?=<note\b|<\/layer>|<\/chord>)/g;
  let m;
  while ((m = re.exec(mei))) {
    if (m[0].startsWith('<measure')) { measure++; continue; }
    if (m[0].startsWith('<staff')) { staff = Number(m[1]); continue; }
    const attrs = m[2];
    const get = (name) => (attrs.match(new RegExp(`\\b${name.replace('.', '\\.')}="([^"]+)"`)) || [])[1];
    const pname = get('pname'), oct = Number(get('oct'));
    if (!pname) continue;
    const inner = m[4] || '';
    const accid = get('accid') || get('accid.ges') || (inner.match(/\baccid="([^"]+)"/) || [])[1] || (inner.match(/\baccid\.ges="([^"]+)"/) || [])[1];
    notes.push({ staff, measure, midi: 12 * (oct + 1) + STEP[pname] + (ALTER[accid] || 0) });
  }
  return notes;
}

/**
 * @param {string} data  ABC, or MEI (see mei() below)
 * @param {{ from?: 'abc'|'mei', width?: number, scale?: number, rotate?: number, noise?: number }} options
 * @returns {Promise<{ img: {data, width, height}, notes: object[], svg: string }>}
 */
export async function engrave(data, { from = data.trimStart().startsWith('<') ? 'mei' : 'abc', width = 2550, scale = 40, rotate = 0, noise = 0, blur = 0, shapes = null, photo = false } = {}) {
  const tk = await verovio();
  tk.setOptions({ inputFrom: from, pageWidth: Math.round((2100 * 40) / scale), pageHeight: Math.round((2970 * 40) / scale), scale: 40, adjustPageHeight: true, header: 'none', footer: 'none', breaks: 'auto' });
  if (!tk.loadData(data)) throw new Error('Verovio could not read the test tune');
  let svg = tk.renderToSVG(1);
  const notes = notesOf(tk.getMEI());
  if (shapes != null) svg = shapeNotes(svg, notes, shapes);
  if (rotate) svg = svg.replace(/(<svg[^>]*>)/, `$1<g transform="rotate(${rotate} 1000 500)">`).replace(/<\/svg>\s*$/, '</g></svg>');
  const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: width }, background: 'white', font: { loadSystemFonts: true } }).render();
  let img = { data: new Uint8ClampedArray(rendered.pixels), width: rendered.width, height: rendered.height };
  if (photo) img = photographed(img);
  if (blur) softened(img);
  if (noise) speckled(img, noise);
  return { img, notes, svg };
}

// Seven-shape heads (do re mi fa sol la ti, as in Walker's Christian Harmony
// and other shape-note books), chosen by each note's step in the key whose
// key note is `tonic` (0 = C). Stems are run on to the shape's corner, as
// those books print them.
const SHAPE_OF_STEP = { 0: 'do', 2: 're', 4: 'mi', 5: 'fa', 7: 'sol', 9: 'la', 11: 'ti' };
function shapeNotes(svg, notes, tonic) {
  let n = 0;
  return svg.replace(/(<g class="notehead">\s*)<use xlink:href="#(E0A[234])[^"]*" transform="translate\((-?\d+), (-?\d+)\)[^"]*" \/>(\s*<\/g>\s*(?:<g[^>]*class="stem">\s*<path d="M(-?\d+) (-?\d+) L(-?\d+) (-?\d+)"[^/]*\/>)?)/g,
    (whole, open, glyph, xs, ys, rest, sx, sy1, sx2, sy2) => {
      const note = notes[n++];
      const shape = note ? SHAPE_OF_STEP[(((note.midi - tonic) % 12) + 12) % 12] : null;
      if (!shape || shape === 'sol' || glyph === 'E0A2') return whole;
      const x = Number(xs), y = Number(ys), w = shape === 'mi' ? 270 : shape === 'la' ? 250 : 212, h = 90;
      const path = {
        do: `M${x} ${y + h}L${x + w} ${y + h}L${x + w / 2} ${y - h}Z`,
        re: `M${x} ${y - h}L${x + w} ${y - h}A${w / 2} ${2 * h} 0 0 1 ${x} ${y - h}Z`,
        mi: `M${x + w / 2} ${y - h}L${x + w} ${y}L${x + w / 2} ${y + h}L${x} ${y}Z`,
        fa: `M${x + w} ${y - h}L${x + w} ${y + h}L${x} ${y + h}Z`,
        la: `M${x + 15} ${y - h + 10}H${x + w - 15}V${y + h - 10}H${x + 15}Z`,
        ti: `M${x} ${y - h / 2}Q${x + w / 2} ${y - 1.4 * h} ${x + w} ${y - h / 2}L${x + w / 2} ${y + h}Z`,
      }[shape];
      const filled = glyph === 'E0A4';
      const head = `<path d="${path}" ${filled ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="26" stroke-linejoin="round"'} />`;
      let tail = rest;
      if (sx != null) {
        // Run the stem on to the top or bottom of the shape.
        const top = Math.min(Number(sy1), Number(sy2)), bottom = Math.max(Number(sy1), Number(sy2));
        const up = Number(sx) > x + w / 2;
        const from = up ? Math.max(bottom, y + h) : Math.min(top, y - h);
        const to = up ? top : bottom;
        tail = rest.replace(/<path d="M-?\d+ -?\d+ L-?\d+ -?\d+"/, `<path d="M${sx} ${from} L${sx2} ${to}"`);
      }
      return open + head + tail;
    });
}

// A photographed book page: the paper bows a little (lines curve), and a
// hand's shadow falls across part of it.
function photographed({ data, width: W, height: H }) {
  const out = new Uint8ClampedArray(data.length).fill(255);
  const bow = 0.012 * W;
  for (let x = 0; x < W; x++) {
    const dy = bow * Math.sin((Math.PI * x) / W) + 0.006 * (x - W / 2);
    // Shadow: darker in a band about a third of the way across, soft at its edges.
    const t = (x - 0.38 * W) / (0.12 * W);
    const shade = 1 - 0.5 * Math.exp(-(t ** 4));
    for (let y = 0; y < H; y++) {
      const sy = Math.round(y - dy);
      const v = sy >= 0 && sy < H ? data[(sy * W + x) * 4] : 255;
      const p = (y * W + x) * 4;
      out[p] = out[p + 1] = out[p + 2] = v * shade;
      out[p + 3] = 255;
    }
  }
  return { data: out, width: W, height: H };
}

// Scanner-like softening: a small box blur.
function softened(img) {
  const { data, width: W, height: H } = img;
  const src = data.slice();
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += src[((y + dy) * W + x + dx) * 4];
      const v = sum / 9, p = (y * W + x) * 4;
      data[p] = data[p + 1] = data[p + 2] = v;
    }
  }
}

// Paper grain and specks, from a fixed seed so tests repeat.
function speckled(img, amount) {
  let seed = 12345;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const { data } = img;
  for (let p = 0; p < data.length; p += 4) {
    let v = data[p] + (rand() - 0.5) * 60 * amount;
    if (rand() < 0.0004 * amount) v = 40;
    data[p] = data[p + 1] = data[p + 2] = Math.max(0, Math.min(255, v));
  }
}

const SHARPS = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLATS = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
const DUR = { w: 1, h: 2, q: 4, e: 8, s: 16 };

/**
 * Writes MEI for a short piece from a compact description, so tests can
 * describe hymns and lead sheets in a few lines.
 *   staves: [{ clef: 'G2'|'F4'|'G2_8', voices: ['G4q G4q F#4q E4q | D4h ...', ...] }]
 *   Notes: letter, optional #/b/n, octave, duration (w h q e s), optional '.' for a dot.
 *   Chords: [G4,B4,D5]q. Rests: rq. Bars: |.
 * Accidentals are printed only where the key does not already give them.
 */
export function mei({ fifths = 0, meter = '4/4', staves, lyrics = [], barThru = false }) {
  const keyAlter = new Map();
  (fifths > 0 ? SHARPS.slice(0, fifths) : FLATS.slice(0, -fifths)).forEach((l) => keyAlter.set(l, fifths > 0 ? 's' : 'f'));
  const parsed = staves.map((staff) => staff.voices.map((voice) => voice.trim().split('|').map((bar) => bar.trim().split(/\s+/).filter(Boolean))));
  const measures = Math.max(...parsed.flat().map((v) => v.length));
  let lyric = 0;
  const noteXml = (token, held, dur, dots, stem, words) => {
    const m = token.match(/^([A-G])(#|b|n)?(-?\d)$/);
    if (!m) throw new Error(`bad note ${token}`);
    const [, letter, acc, oct] = m;
    const written = acc === '#' ? 's' : acc === 'b' ? 'f' : acc === 'n' ? 'n' : null;
    const sounding = written || held.get(letter + oct) || keyAlter.get(letter) || 'n';
    const current = held.get(letter + oct) || keyAlter.get(letter) || 'n';
    let attrs = `pname="${letter.toLowerCase()}" oct="${oct}"`;
    if (written && written !== current) { attrs += ` accid="${written}"`; held.set(letter + oct, written); }
    else if (sounding !== 'n') attrs += ` accid.ges="${sounding}"`;
    if (dur) attrs += ` dur="${dur}"${dots ? ' dots="1"' : ''}`;
    if (stem) attrs += ` stem.dir="${stem}"`;
    const verse = words && lyrics[lyric] != null ? `<verse n="1"><syl>${lyrics[lyric++]}</syl></verse>` : '';
    return verse ? `<note ${attrs}>${verse}</note>` : `<note ${attrs}/>`;
  };
  let body = '';
  for (let m = 0; m < measures; m++) {
    body += `<measure n="${m + 1}"${m === measures - 1 ? ' right="end"' : ''}>`;
    parsed.forEach((voices, s) => {
      body += `<staff n="${s + 1}">`;
      voices.forEach((bars, v) => {
        const held = new Map();
        const stem = voices.length > 1 ? (v === 0 ? 'up' : 'down') : null;
        body += `<layer n="${v + 1}">`;
        for (const token of bars[m] || []) {
          const t = token.match(/^(.*?)([whqes])(\.?)$/);
          const [, pitch, d, dot] = t;
          const dur = DUR[d];
          const words = s === 0 && v === 0;
          if (pitch === 'r') { body += `<rest dur="${dur}"${dot ? ' dots="1"' : ''}/>`; continue; }
          if (pitch.startsWith('[')) {
            const inner = pitch.slice(1, -1).split(',');
            body += `<chord dur="${dur}"${dot ? ' dots="1"' : ''}${stem ? ` stem.dir="${stem}"` : ''}>${inner.map((p, i) => noteXml(p, held, null, false, null, words && i === inner.length - 1)).join('')}</chord>`;
          } else body += noteXml(pitch, held, dur, !!dot, stem, words);
        }
        body += '</layer>';
      });
      body += '</staff>';
    });
    body += '</measure>';
  }
  const [count, unit] = meter.split('/');
  const clefs = { G2: 'clef.shape="G" clef.line="2"', F4: 'clef.shape="F" clef.line="4"', G2_8: 'clef.shape="G" clef.line="2" clef.dis="8" clef.dis.place="below"' };
  const keysig = fifths > 0 ? `${fifths}s` : fifths < 0 ? `${-fifths}f` : '0';
  const staffDefs = staves.map((s, i) => `<staffDef n="${i + 1}" lines="5" ${clefs[s.clef || 'G2']}/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0"><music><body><mdiv><score>`
    + `<scoreDef meter.count="${count}" meter.unit="${unit}" keysig="${keysig}"><staffGrp${staves.length > 1 ? ` symbol="brace" bar.thru="${barThru}"` : ''}>${staffDefs}</staffGrp></scoreDef>`
    + `<section>${body}</section></score></mdiv></body></music></mei>`;
}
