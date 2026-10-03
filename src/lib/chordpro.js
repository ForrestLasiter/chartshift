// ChordPro (.cho / .chopro) import and export, the plain-text chord chart
// format most worship and songbook apps understand:  [G]Morning [C]light
import { isChord, isChordLine } from './chords.js';
import { LINE_HEIGHT, measureText } from './text.js';

const SECTION_RE = /^(verse|chorus|pre[- ]?chorus|bridge|intro|outro|tag|interlude|instrumental|ending|refrain|turnaround|vamp)\b/i;
const SANS = 'Arial, Helvetica, sans-serif';
const PAGE = { w: 612, h: 792, margin: 54 };
const CHORD_COLOR = '#1e3a8a';

export const isSectionHeader = (text) => SECTION_RE.test(text.trim());

export function parseChordPro(source) {
  const song = { title: '', subtitle: '', key: '', capo: '', lines: [] };
  for (const raw of source.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('#')) continue;
    const directive = line.match(/^\s*\{([^:}]+)(?::\s*(.*?))?\s*\}\s*$/);
    if (directive) {
      const name = directive[1].trim().toLowerCase();
      const value = directive[2] || '';
      if (name === 'title' || name === 't') song.title = value;
      else if (name === 'subtitle' || name === 'st' || name === 'artist') song.subtitle = song.subtitle || value;
      else if (name === 'key') song.key = value;
      else if (name === 'capo') song.capo = value;
      else if (name === 'comment' || name === 'c' || name === 'ci' || name === 'comment_italic') song.lines.push({ type: 'comment', text: value });
      else if (/^(start_of_|so)/.test(name)) {
        const kind = name.replace(/^start_of_/, '').replace(/^so/, '');
        const label = value || { chorus: 'Chorus', c: 'Chorus', verse: 'Verse', v: 'Verse', bridge: 'Bridge', b: 'Bridge', tab: 'Tab', t: 'Tab' }[kind] || 'Section';
        song.lines.push({ type: 'start', label });
      } else if (/^(end_of_|eo)/.test(name)) song.lines.push({ type: 'end' });
      continue;
    }
    if (!line.trim()) { song.lines.push({ type: 'blank' }); continue; }
    const chords = [];
    let lyric = '';
    let rest = line;
    for (;;) {
      const open = rest.indexOf('[');
      const close = rest.indexOf(']', open);
      if (open < 0 || close < 0) break;
      lyric += rest.slice(0, open);
      chords.push({ index: lyric.length, name: rest.slice(open + 1, close) });
      rest = rest.slice(close + 1);
    }
    lyric += rest;
    song.lines.push({ type: 'lyric', lyric, chords });
  }
  while (song.lines.length && song.lines[song.lines.length - 1].type === 'blank') song.lines.pop();
  return song;
}

/** Lays a parsed ChordPro song out as pages of text boxes. */
export function layoutChordPro(song, ids) {
  const pages = [];
  let page = null, y = 0, section = null;
  const newPage = () => {
    page = { id: ids.page++, w: PAGE.w, h: PAGE.h, pieces: [], sections: [] };
    pages.push(page);
    y = PAGE.margin;
    if (section) page.sections.push(section);
  };
  const room = (height) => { if (!page || y + height > PAGE.h - PAGE.margin) newPage(); };
  const add = (text, x, top, style) => {
    const piece = { id: ids.piece++, kind: 'text', x, y: top, text, font: SANS, size: 12, bold: false, italic: false, color: '#000000', ...style };
    Object.assign(piece, measureText(piece));
    if (section) piece.section = section.id;
    page.pieces.push(piece);
    return piece;
  };
  const startSection = (label) => {
    section = { id: ids.group++, label };
    if (page) page.sections.push(section);
  };

  newPage();
  if (song.title) { add(song.title, PAGE.margin, y, { size: 20, bold: true }); y += 28; }
  if (song.subtitle) { add(song.subtitle, PAGE.margin, y, { size: 11 }); y += 16; }
  const facts = [song.key && `Key: ${song.key}`, song.capo && `Capo: ${song.capo}`].filter(Boolean).join('    ');
  if (facts) { add(facts, PAGE.margin, y, { size: 11, italic: true }); y += 16; }
  y += 10;

  for (const line of song.lines) {
    if (line.type === 'blank') { y += 10; if (section?.implicit) section = null; continue; }
    if (line.type === 'end') { section = null; y += 6; continue; }
    if (line.type === 'start') {
      room(40);
      startSection(line.label);
      add(line.label, PAGE.margin, y, { bold: true });
      y += 18;
      continue;
    }
    if (line.type === 'comment') {
      room(40);
      if (isSectionHeader(line.text)) { startSection(line.text); section.implicit = true; }
      add(line.text, PAGE.margin, y, isSectionHeader(line.text) ? { bold: true } : { italic: true });
      y += 18;
      continue;
    }
    const hasChords = line.chords.length > 0;
    room(hasChords ? 32 : 16);
    if (hasChords) {
      let minX = PAGE.margin;
      for (const chord of line.chords) {
        const prefix = measureText({ text: line.lyric.slice(0, chord.index), font: SANS, size: 12 }).w;
        const x = Math.max(PAGE.margin + (chord.index ? prefix : 0), minX);
        const piece = add(chord.name, x, y, { bold: true, color: CHORD_COLOR, ...(isChord(chord.name) ? { chord: true } : null) });
        minX = x + piece.w + 5;
      }
      y += 14;
    }
    if (line.lyric.trim()) { add(line.lyric, PAGE.margin, y, {}); y += 17; }
    else if (hasChords) y += 3;
  }
  for (const p of pages) for (const s of p.sections) delete s.implicit;
  return pages;
}

// --- export ---------------------------------------------------------------

function pageItems(page) {
  const items = [];
  const tokens = new Map();
  for (const p of page.pieces) {
    if (p.kind === 'text') {
      const step = p.size * LINE_HEIGHT;
      p.text.split('\n').forEach((line, i) => {
        for (const match of line.matchAll(/\S+/g)) {
          const x = p.x + (match.index ? measureText({ ...p, text: line.slice(0, match.index) }).w : 0);
          const w = measureText({ ...p, text: match[0] }).w;
          items.push({ text: match[0], x, w, bottom: p.y + (i + 1) * step - p.size * 0.25, h: p.size * 0.8, chord: !!p.chord });
        }
      });
    } else if (p.t && !p.contained) {
      // (numbers inside a tab staff are not lyrics)
      let tok = tokens.get(p.tok);
      if (!tok) {
        tok = { text: p.t, x: p.x, right: p.x + p.w, top: p.y, bottom: p.y + p.h, chord: !!p.chord };
        tokens.set(p.tok, tok);
      } else {
        tok.x = Math.min(tok.x, p.x);
        tok.right = Math.max(tok.right, p.x + p.w);
        tok.top = Math.min(tok.top, p.y);
        tok.bottom = Math.max(tok.bottom, p.y + p.h);
      }
    }
  }
  for (const tok of tokens.values()) items.push({ text: tok.text, x: tok.x, w: tok.right - tok.x, bottom: tok.bottom, h: tok.bottom - tok.top, chord: tok.chord });
  return items;
}

function mergeChordsIntoLyric(chordRow, lyricRow) {
  let lyric = '';
  const spans = [];
  for (const item of lyricRow.items) {
    if (lyric) lyric += ' ';
    spans.push({ start: lyric.length, length: item.text.length, x0: item.x, x1: item.x + item.w });
    lyric += item.text;
  }
  const inserts = chordRow.items.map((chord) => {
    const span = spans.find((s) => s.x1 > chord.x);
    if (!span) return { index: lyric.length, name: chord.text, pad: true };
    if (chord.x <= span.x0) return { index: span.start, name: chord.text };
    return { index: span.start + Math.round(((chord.x - span.x0) / (span.x1 - span.x0)) * span.length), name: chord.text };
  });
  for (const insert of inserts.reverse()) {
    lyric = `${lyric.slice(0, insert.index)}${insert.pad ? ' ' : ''}[${insert.name}]${lyric.slice(insert.index)}`;
  }
  return lyric;
}

/** Writes the song's recognised text as ChordPro. Returns null if no text is known. */
export function exportChordPro(pages, title) {
  const out = [`{title: ${title}}`, ''];
  let any = false;
  for (const page of pages) {
    const items = pageItems(page).sort((a, b) => a.bottom - b.bottom);
    const rows = [];
    for (const item of items) {
      const row = rows[rows.length - 1];
      if (row && Math.abs(row.bottom - item.bottom) < Math.max(item.h, row.h) * 0.6) row.items.push(item);
      else rows.push({ bottom: item.bottom, h: item.h, items: [item] });
    }
    let previous = null;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      row.items.sort((a, b) => a.x - b.x);
      const texts = row.items.map((item) => item.text);
      const chordRow = row.items.every((item) => item.chord) || isChordLine(texts);
      if (previous && row.bottom - previous.bottom > 2.6 * Math.max(row.h, previous.h) + (chordRow ? row.h : 0)) out.push('');
      const next = rows[i + 1];
      any = true;
      if (chordRow && next && !(next.items.every((item) => item.chord) || isChordLine(next.items.map((item) => item.text)))
        && next.bottom - row.bottom < 3 * Math.max(row.h, next.h)) {
        next.items.sort((a, b) => a.x - b.x);
        out.push(mergeChordsIntoLyric(row, next));
        previous = next;
        i++;
      } else if (chordRow) {
        out.push(texts.map((text) => (isChord(text) ? `[${text}]` : text)).join(' '));
        previous = row;
      } else {
        const text = texts.join(' ');
        out.push(isSectionHeader(text) ? `{comment: ${text}}` : text);
        previous = row;
      }
    }
    out.push('');
  }
  return any ? out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n' : null;
}
