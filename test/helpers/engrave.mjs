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
export async function engrave(data, { from = data.trimStart().startsWith('<') ? 'mei' : 'abc', width = 2550, scale = 40, rotate = 0, noise = 0, blur = 0 } = {}) {
  const tk = await verovio();
  tk.setOptions({ inputFrom: from, pageWidth: Math.round((2100 * 40) / scale), pageHeight: Math.round((2970 * 40) / scale), scale: 40, adjustPageHeight: true, header: 'none', footer: 'none', breaks: 'auto' });
  if (!tk.loadData(data)) throw new Error('Verovio could not read the test tune');
  let svg = tk.renderToSVG(1);
  if (rotate) svg = svg.replace(/(<svg[^>]*>)/, `$1<g transform="rotate(${rotate} 1000 500)">`).replace(/<\/svg>\s*$/, '</g></svg>');
  const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: width }, background: 'white', font: { loadSystemFonts: true } }).render();
  const img = { data: new Uint8ClampedArray(rendered.pixels), width: rendered.width, height: rendered.height };
  if (blur) softened(img);
  if (noise) speckled(img, noise);
  return { img, notes: notesOf(tk.getMEI()), svg };
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
