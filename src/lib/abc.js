// Reading hymns written in ABC notation (as the Open Hymnal Project keeps
// them): the parts, their notes in time, and the verses sung to the tune.
// Only what hymns use is read; ornaments, MIDI settings and the like are
// passed over. Pure, no DOM.

const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARPS = 'FCGDAEB', FLATS = 'BEADGCF';
// Key note -> number of sharps (negative: flats) for a major key.
const MAJOR_FIFTHS = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };
const MODE_SHIFT = { maj: 0, ion: 0, min: -3, m: -3, aeo: -3, mix: -1, dor: -2, phr: -4, lyd: 1, loc: -5 };

/** The key in a K: field: { fifths, tonic (pitch class), minor }. */
export function parseKey(text) {
  const m = /^\s*([A-G])([#b]?)\s*([A-Za-z]*)/.exec(text || '');
  if (!m) return { fifths: 0, tonic: 0, minor: false };
  const mode = (m[3] || 'maj').toLowerCase().slice(0, 3);
  const shift = MODE_SHIFT[mode] ?? (mode.startsWith('m') ? -3 : 0);
  const name = m[1] + m[2];
  // The major key with the same signature, found by walking the circle.
  const tonic = (LETTER_PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  // The signature of the major key on that note, then moved for the mode.
  let fifths = null;
  for (const [key, f] of Object.entries(MAJOR_FIFTHS)) {
    const pc = (LETTER_PC[key[0]] + (key[1] === '#' ? 1 : key[1] === 'b' ? -1 : 0) + 12) % 12;
    if (pc === tonic && (fifths === null || key === name)) fifths = f;
  }
  fifths = (fifths ?? 0) + shift;
  if (fifths > 7) fifths -= 12;
  if (fifths < -7) fifths += 12;
  return { fifths, tonic, minor: shift === -3 };
}

const fraction = (text, fallback) => {
  const m = /^\s*(\d+)\s*\/\s*(\d+)/.exec(text || '');
  return m ? Number(m[1]) / Number(m[2]) : fallback;
};

/**
 * Reads an ABC tune.
 * @returns {{ title, credits: string[], key, meter: {num, den}|null, voices: Map<string, {
 *   events: {time, duration, midi: number[], tieIn: boolean}[], bars: number[],
 *   segments: { from, to, start, end, lyrics: string[] }[] }>, order: string[], words: string[] }}
 * Times and durations are in whole notes. A segment is one line of music as
 * written for that part, with the verse lines (w:) written under it.
 */
export function parseAbc(text) {
  const lines = String(text).replace(/\r/g, '').split('\n');
  const tune = { title: '', credits: [], key: parseKey('C'), meter: null, voices: new Map(), order: [], words: [] };
  let unit = 1 / 8, unitSet = false, inBody = false, current = null;
  const voice = (id) => {
    if (!tune.voices.has(id)) {
      tune.voices.set(id, { events: [], bars: [], segments: [], time: 0, ties: new Map(), alter: new Map() });
      tune.order.push(id);
    }
    return tune.voices.get(id);
  };
  const header = (field, value) => {
    if (field === 'T' && !tune.title) tune.title = value.trim();
    else if (field === 'C') tune.credits.push(value.trim());
    else if (field === 'M') {
      const m = /(\d+)\s*\/\s*(\d+)/.exec(value);
      tune.meter = m ? { num: Number(m[1]), den: Number(m[2]) } : /C\|/.test(value) ? { num: 2, den: 2 } : /C/.test(value) ? { num: 4, den: 4 } : null;
      if (!unitSet) unit = tune.meter && tune.meter.num / tune.meter.den < 0.75 ? 1 / 16 : 1 / 8;
    } else if (field === 'L') { unit = fraction(value, unit); unitSet = true; }
    else if (field === 'K') { tune.key = parseKey(value); inBody = true; }
    else if (field === 'V') current = voice(value.trim().split(/\s+/)[0]);
  };
  let inText = false;
  for (const raw of lines) {
    // Notes printed under the hymn (%%begintext ... %%endtext) are not music.
    if (/^%%begintext/.test(raw)) { inText = true; continue; }
    if (/^%%endtext/.test(raw)) { inText = false; continue; }
    if (inText) continue;
    const line =raw.replace(/(^|[^\\])%.*$/, '$1');
    if (!line.trim()) continue;
    const field = /^([A-Za-z]):(.*)$/.exec(line);
    if (field && !/^\[/.test(line)) {
      const [, f, value] = field;
      if (f === 'w') { if (current && current.segments.length) current.segments[current.segments.length - 1].lyrics.push(value); continue; }
      if (f === 'W') { tune.words.push(value.trim()); continue; }
      header(f, value.replace(/%.*$/, ''));
      continue;
    }
    if (!inBody) continue;
    // A line of music, maybe starting with [V: id].
    let body = line;
    const v = /^\s*\[V:\s*([^\]\s]+)[^\]]*\]/.exec(body);
    if (v) { current = voice(v[1]); body = body.slice(v[0].length); }
    if (!current) current = voice('1');
    readMusicLine(current, body, unit, tune);
  }
  for (const v of tune.voices.values()) { delete v.time; delete v.ties; delete v.alter; }
  return tune;
}

function readMusicLine(v, body, unit, tune) {
  const segment = { from: v.events.length, start: v.time, lyrics: [] };
  let i = 0, tuplet = null;
  const keyAlter = (letter) => {
    const f = tune.key.fifths;
    if (f > 0 && SHARPS.slice(0, f).includes(letter)) return 1;
    if (f < 0 && FLATS.slice(0, -f).includes(letter)) return -1;
    return 0;
  };
  const readLength = () => {
    let m = /^(\d*)(\/*)(\d*)/.exec(body.slice(i));
    i += m[0].length;
    let n = m[1] ? Number(m[1]) : 1, d = 1;
    if (m[2]) d = m[3] ? Number(m[3]) : 2 ** m[2].length;
    return n / d;
  };
  // One pitch at body[i]: accidental, letter, octave marks. Returns midi or null.
  const readPitch = () => {
    const m = /^(\^\^|__|\^|_|=)?([A-Ga-g])([,']*)/.exec(body.slice(i));
    if (!m) return null;
    i += m[0].length;
    const letter = m[2].toUpperCase();
    let octave = m[2] === letter ? 4 : 5;
    for (const c of m[3]) octave += c === ',' ? -1 : 1;
    const spot = letter + octave;
    if (m[1]) v.alter.set(spot, { '^^': 2, '^': 1, '=': 0, _: -1, __: -2 }[m[1]]);
    const alter = v.alter.has(spot) ? v.alter.get(spot) : keyAlter(letter);
    return 12 * (octave + 1) + LETTER_PC[letter] + alter;
  };
  const push = (midi, length) => {
    let duration = length * unit;
    if (tuplet) { duration *= tuplet.q / tuplet.p; if (--tuplet.r <= 0) tuplet = null; }
    const tieIn = midi.length > 0 && midi.every((m) => v.ties.has(m));
    v.events.push({ time: v.time, duration, midi, tieIn });
    v.ties = new Map();
    v.time += duration;
    return v.events[v.events.length - 1];
  };
  let broken = null; // a > or < waiting for the next note
  const applyBroken = (event) => {
    if (!broken) return;
    const { prev, dots, sign } = broken;
    broken = null;
    const total = prev.duration + event.duration;
    const longer = 1 - 0.5 ** dots;
    const [a, b] = sign === '>' ? [total / 2 * (1 + longer), total / 2 * (1 - longer)] : [total / 2 * (1 - longer), total / 2 * (1 + longer)];
    v.time -= total;
    prev.duration = a;
    event.time = prev.time + a;
    event.duration = b;
    v.time = event.time + b;
  };
  while (i < body.length) {
    const c = body[i];
    const rest = body.slice(i);
    let m;
    if (c === ' ' || c === '\t' || c === '`') { i++; continue; }
    // A second part overlaid in the same bar (&): only the first is kept.
    if (c === '&') { const end = body.indexOf('|', i); i = end < 0 ? body.length : end; continue; }
    if (c === '!' || c === '+') { const end = body.indexOf(c, i + 1); i = end < 0 ? body.length : end + 1; continue; }
    if (c === '"') { const end = body.indexOf('"', i + 1); i = end < 0 ? body.length : end + 1; continue; }
    if (c === '{') { const end = body.indexOf('}', i + 1); i = end < 0 ? body.length : end + 1; continue; } // grace notes
    if ((m = /^\[[A-Za-z]:[^\]]*\]/.exec(rest))) {
      const [, f, value] = /^\[([A-Za-z]):([^\]]*)\]/.exec(m[0]);
      if (f === 'K') tune.key = parseKey(value);
      if (f === 'M') { const mm = /(\d+)\s*\/\s*(\d+)/.exec(value); if (mm) tune.meter = { num: Number(mm[1]), den: Number(mm[2]) }; }
      if (f === 'L') unit = fraction(value, unit);
      i += m[0].length;
      continue;
    }
    if ((m = /^(\|\]|\|\||\[\||:*\|:*|::|:)\s*(\[?\d+([,-]\d+)*\.?)?/.exec(rest)) && m[0].trim()) {
      if (/[|:]/.test(m[1])) { v.bars.push(v.time); v.alter = new Map(); }
      i += m[0].length;
      continue;
    }
    if ((m = /^\[\d+/.exec(rest))) { i += m[0].length; continue; } // a numbered ending
    if ((m = /^\((\d)(?::(\d*))?(?::(\d*))?/.exec(rest))) {
      const p = Number(m[1]);
      const q = m[2] ? Number(m[2]) : { 2: 3, 3: 2, 4: 3, 6: 2, 8: 3 }[p] || 2;
      tuplet = { p, q, r: m[3] ? Number(m[3]) : p };
      i += m[0].length;
      continue;
    }
    if (c === '(' || c === ')' || c === '.' || c === '~' || c === 'H' || c === 'T' || c === 'u' || c === 'v' || c === 'L' || c === 'M' || c === 'O' || c === 'P' || c === 'S') { i++; continue; }
    if ((m = /^([<>]+)/.exec(rest))) {
      const prev = v.events[v.events.length - 1];
      if (prev) broken = { prev, dots: m[1].length, sign: m[1][0] };
      i += m[0].length;
      continue;
    }
    if (c === '-') { const last = v.events[v.events.length - 1]; if (last) for (const midi of last.midi) v.ties.set(midi, true); i++; continue; }
    if (c === 'z' || c === 'x' || c === 'Z' || c === 'X') {
      i++;
      const length = readLength();
      const event = push([], c === 'Z' || c === 'X' ? length * (tune.meter ? tune.meter.num / tune.meter.den : 1) / unit : length);
      applyBroken(event);
      continue;
    }
    if (c === '[') {
      // A chord: several pitches sounding together.
      i++;
      const midi = [], out = new Map();
      let length = null;
      while (i < body.length && body[i] !== ']') {
        const before = i;
        const p = readPitch();
        if (p !== null) { midi.push(p); const l = readLength(); if (length === null) length = l; if (body[i] === '-') { out.set(p, true); i++; } continue; }
        i = before + 1;
      }
      i++;
      const event = push(midi, (length ?? 1) * readLength());
      // Notes tied inside the chord go on into the next one.
      v.ties = out;
      applyBroken(event);
      continue;
    }
    const before = i;
    const p = readPitch();
    if (p !== null) {
      const event = push([p], readLength());
      applyBroken(event);
      continue;
    }
    i = before + 1; // anything else is passed over
  }
  segment.to = v.events.length;
  segment.end = v.time;
  if (segment.to > segment.from || segment.lyrics.length) v.segments.push(segment);
}

/**
 * The syllables of one w: line, each with the note it is sung to:
 * [{ text, note (index into notes), joinsNext }]. notes: the events of the
 * segment it was written under, in order.
 */
export function alignLyrics(line, events, bars = []) {
  // Every note takes a syllable (or a * or _ in its place), tied ones
  // included, as abcm2ps lays them out; rests do not.
  const singable = [];
  events.forEach((e, k) => { if (e.midi.length) singable.push(k); });
  const out = [];
  let n = 0;
  const tokens = [];
  // Split into syllables, hyphens, holds, skips and bar marks.
  const re = /\\-|[^\s\-_*|~\\]+(?:~[^\s\-_*|~\\]+)*|~|-|_|\*|\|/g;
  let m;
  const text = line.replace(/\\-/g, '\u2010');
  while ((m = re.exec(text))) tokens.push(m[0]);
  let afterHyphen = false;
  for (const t of tokens) {
    if (t === '-') {
      if (afterHyphen) n++; // a second hyphen: the word goes on over another note
      else if (out.length) { out[out.length - 1].joinsNext = true; afterHyphen = true; }
      continue;
    }
    afterHyphen = false;
    if (t === '_') { n++; continue; }
    if (t === '*') { n++; continue; }
    if (t === '|') {
      // On to the first note of the next bar.
      const at = n < singable.length ? events[singable[n]].time : Infinity;
      const nextBar = bars.find((b) => b > (n > 0 && n - 1 < singable.length ? events[singable[n - 1]].time : -1));
      if (nextBar !== undefined && at < nextBar) while (n < singable.length && events[singable[n]].time < nextBar) n++;
      continue;
    }
    if (t === '~') continue;
    if (n >= singable.length) break;
    out.push({ text: t.replace(/~/g, ' ').replace(/\u2010/g, '-'), note: singable[n], joinsNext: false });
    n++;
  }
  return out;
}
