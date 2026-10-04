// ChordPro (.cho / .chopro) import and export, the plain-text chord chart
// format most worship and songbook apps understand:  [G]Morning [C]light
import { isChord, isChordLine, isNeutral } from './chords.js';
import { chordTokens } from './textlayer.js';
import { guttersOfPages, inColumns, median, rowsOf } from './rows.js';
import { LINE_HEIGHT, measureText } from './text.js';
import { DIAGRAM_SIZE, shapeFor } from './diagrams.js';

// Words that name a part of a song.
const PART = '(?:verse|chorus|pre[- ]?chorus|post[- ]?chorus|bridge|intro|outro|tag|interlude|instrumental|ending|refrain|turnaround|vamp|solo|hook|break|breakdown|coda|riff|lead|link|middle ?8)';
// A bare heading: "Verse 1", "Chorus x2", "Intro riff", "Verse 2:", "Bridge (softly)".
const BARE_HEADING = new RegExp(`^${PART}(?:\\s+${PART})?(?:\\s*\\d+[a-z]?)?\\s*(?:x\\s*\\d+|\\(.*\\)|[:\\-].*)?$`, 'i');
const STARTS_WITH_PART = new RegExp(`^${PART}\\b`, 'i');
const SANS = 'Arial, Helvetica, sans-serif';
const PAGE = { w: 612, h: 792, margin: 54 };
const CHORD_COLOR = '#1e3a8a';

/**
 * If a line of text is a section heading, returns its name; otherwise null.
 * Recognises bare headings ("Verse 1", "Chorus x2") and bracketed ones as
 * used by Ultimate Guitar and similar sites: "[Verse 1]", "[Guitar Solo]",
 * "[Chorus] x2", "(Bridge)". Anything in square brackets counts unless it is
 * a chord; round brackets must contain a part name.
 */
export function sectionLabel(text) {
  let raw = text.trim().replace(/\s+/g, ' ');
  if (!raw || raw.length > 48) return null;
  // OCR often reads "[" as I, l, | or 1 when the line still ends with "]".
  if (/\]\s*(x\s*\d+)?[:.]?$/i.test(raw) && /^[Il|1](?=[A-Z])/.test(raw)) raw = `[${raw.slice(1)}`;
  const bracketed = raw.match(/^([\[({])\s*([^\])}]{2,40}?)\s*[\])}]\s*(?:\(?x\s*\d+\)?)?[:.]?$/i);
  if (bracketed) {
    const inner = bracketed[2].trim();
    if (STARTS_WITH_PART.test(inner)) return inner;
    if (bracketed[1] === '[' && !isChordLine(inner.split(' '))) return inner;
    return null;
  }
  const bare = raw.replace(/^[\s*#:.\-–—|]+/, '').replace(/[\s*#.\-–—|]+$/, '');
  return BARE_HEADING.test(bare) ? bare.replace(/:$/, '') : null;
}

export const isSectionHeader = (text) => sectionLabel(text) !== null;

/**
 * If a line of song text is a section heading, its name; otherwise null.
 * "[Chorus]" is a heading; "[G]" and "[G]Amazing grace" are not.
 */
export function headingOf(line) {
  const text = line.trim();
  if (!text) return null;
  if (text.includes('[') && !/^\[[^\]]*\]\s*(?:\(?x\s*\d+\)?)?[:.]?$/i.test(text)) return null;
  return sectionLabel(text);
}

export function parseChordPro(source) {
  const song = { title: '', subtitle: '', key: '', capo: '', tempo: '', time: '', lines: [] };
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
      else if (name === 'tempo') song.tempo = value;
      else if (name === 'time') song.time = value;
      else if (name === 'comment' || name === 'c' || name === 'ci' || name === 'comment_italic') song.lines.push({ type: 'comment', text: value });
      else if (/^(start_of_|so)/.test(name)) {
        const kind = name.replace(/^start_of_/, '').replace(/^so/, '');
        const label = value || { chorus: 'Chorus', c: 'Chorus', verse: 'Verse', v: 'Verse', bridge: 'Bridge', b: 'Bridge', tab: 'Tab', t: 'Tab' }[kind] || 'Section';
        song.lines.push({ type: 'start', label });
      } else if (/^(end_of_|eo)/.test(name)) song.lines.push({ type: 'end' });
      continue;
    }
    if (!line.trim()) { song.lines.push({ type: 'blank' }); continue; }
    // A heading on a line of its own starts a section that runs to the next heading.
    const heading = headingOf(line);
    if (heading) { song.lines.push({ type: 'heading', label: heading }); continue; }
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

const GUTTER = 28;
const textWidth = (text) => measureText({ text, font: SANS, size: 12 }).w;

// Breaks a line that is too wide for its column at a space, keeping each
// chord with the words it sits over.
function wrapLine(line, maxWidth) {
  const parts = [];
  let { lyric, chords } = line;
  while (lyric.trim() && textWidth(lyric) > maxWidth) {
    let cut = -1;
    for (let i = lyric.length - 1; i > 0; i--) {
      if (lyric[i] === ' ' && textWidth(lyric.slice(0, i)) <= maxWidth) { cut = i; break; }
    }
    if (cut <= 0) break;
    parts.push({ lyric: lyric.slice(0, cut), chords: chords.filter((c) => c.index <= cut) });
    chords = chords.filter((c) => c.index > cut).map((c) => ({ ...c, index: c.index - cut - 1 }));
    lyric = lyric.slice(cut + 1);
  }
  parts.push({ lyric, chords });
  return parts;
}

/**
 * Lays a parsed song out as pages of text boxes.
 * options.diagrams: 'guitar' | 'ukulele' adds a row of chord diagrams under the header.
 * options.columns: 2 sets the words in two columns under the header, which
 * fits about twice as much on a page. Lines too wide for a column are wrapped.
 */
export function layoutChordPro(song, ids, { diagrams = null, columns = 1 } = {}) {
  const count = columns === 2 ? 2 : 1;
  const columnWidth = (PAGE.w - 2 * PAGE.margin - (count - 1) * GUTTER) / count;
  const pages = [];
  let page = null, y = 0, section = null, column = 0, top = PAGE.margin;
  const left = () => PAGE.margin + column * (columnWidth + GUTTER);
  const newPage = () => {
    page = { id: ids.page++, w: PAGE.w, h: PAGE.h, pieces: [], sections: [] };
    pages.push(page);
    column = 0;
    top = PAGE.margin;
    y = top;
    if (section) page.sections.push(section);
  };
  const nextColumn = () => { if (column + 1 < count) { column++; y = top; } else newPage(); };
  const room = (height) => { if (y + height > PAGE.h - PAGE.margin) nextColumn(); };
  const atTop = () => y <= top + 0.5;
  const add = (text, x, at, style) => {
    const piece = { id: ids.piece++, kind: 'text', x, y: at, text, font: SANS, size: 12, bold: false, italic: false, color: '#000000', ...style };
    Object.assign(piece, measureText(piece));
    if (section) piece.section = section.id;
    page.pieces.push(piece);
    return piece;
  };
  const startSection = (label) => {
    section = { id: ids.group++, label };
    if (page) page.sections.push(section);
  };

  // The header runs across the full width; the columns start beneath it.
  newPage();
  if (song.title) { add(song.title, PAGE.margin, y, { size: 20, bold: true }); y += 28; }
  if (song.subtitle) { add(song.subtitle, PAGE.margin, y, { size: 11 }); y += 16; }
  const facts = [
    song.key && `Key: ${song.key}`, song.tempo && `Tempo: ${song.tempo}`, song.time && `Time: ${song.time}`, song.capo && `Capo: ${song.capo}`,
  ].filter(Boolean).join('    ');
  if (facts) { add(facts, PAGE.margin, y, { size: 11, italic: true }); y += 16; }
  y += 10;

  if (diagrams) {
    // One diagram per distinct chord, in order of first appearance.
    const names = [];
    for (const line of song.lines) for (const chord of line.chords || []) if (isChord(chord.name) && !names.includes(chord.name)) names.push(chord.name);
    const drawable = names.filter((name) => shapeFor(name, diagrams));
    let x = PAGE.margin;
    for (const name of drawable) {
      if (x + DIAGRAM_SIZE.w > PAGE.w - PAGE.margin) { x = PAGE.margin; y += DIAGRAM_SIZE.h + 8; }
      page.pieces.push({ id: ids.piece++, kind: 'diagram', chord: name, instrument: diagrams, x, y, w: DIAGRAM_SIZE.w, h: DIAGRAM_SIZE.h });
      x += DIAGRAM_SIZE.w + 10;
    }
    if (drawable.length) y += DIAGRAM_SIZE.h + 18;
  }
  top = y;

  for (const line of song.lines) {
    if (line.type === 'blank') { if (!atTop()) y += 10; if (section?.implicit) section = null; continue; }
    if (line.type === 'end') { section = null; if (!atTop()) y += 6; continue; }
    if (line.type === 'start' || line.type === 'heading') {
      // A heading is kept with at least its first line.
      room(58);
      // Room above a heading for the section's name tag in the editor.
      if (line.type === 'heading' && !atTop()) y += 12;
      startSection(line.label);
      add(line.label, left(), y, { bold: true });
      y += 18;
      continue;
    }
    if (line.type === 'comment') {
      room(40);
      if (isSectionHeader(line.text)) { startSection(line.text); section.implicit = true; }
      add(line.text, left(), y, isSectionHeader(line.text) ? { bold: true } : { italic: true });
      y += 18;
      continue;
    }
    for (const part of wrapLine(line, columnWidth)) {
      const hasChords = part.chords.length > 0;
      room(hasChords ? 32 : 16);
      if (hasChords) {
        let minX = left();
        for (const chord of part.chords) {
          const prefix = textWidth(part.lyric.slice(0, chord.index));
          let x = Math.max(left() + (chord.index ? prefix : 0), minX);
          // A row of chords with no words wraps when it reaches the column's edge.
          if (!part.lyric.trim() && x > left() && x + textWidth(chord.name) > left() + columnWidth) { y += 15; room(16); x = left(); }
          const piece = add(chord.name, x, y, { bold: true, color: CHORD_COLOR, ...(isChord(chord.name) ? { chord: true } : null) });
          minX = x + piece.w + 5;
        }
        y += 14;
      }
      if (part.lyric.trim()) { add(part.lyric, left(), y, {}); y += 17; }
      else if (hasChords) y += 3;
    }
  }
  for (const p of pages) for (const s of p.sections) delete s.implicit;
  return pages;
}

// --- export ---------------------------------------------------------------

// Every recognised word on a page as a box with its text.
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
          const bottom = p.y + (i + 1) * step - p.size * 0.25;
          items.push({ text: match[0], x0: x, x1: x + w, y0: bottom - p.size * 0.8, y1: bottom, chord: !!p.chord });
        }
      });
    } else if (p.t && !p.contained) {
      // (numbers inside a tab staff are not lyrics)
      let tok = tokens.get(p.tok);
      if (!tok) tokens.set(p.tok, (tok = { text: p.t, x0: p.x, x1: p.x + p.w, y0: p.y, y1: p.y + p.h, chord: !!p.chord }));
      else {
        tok.x0 = Math.min(tok.x0, p.x);
        tok.x1 = Math.max(tok.x1, p.x + p.w);
        tok.y0 = Math.min(tok.y0, p.y);
        tok.y1 = Math.max(tok.y1, p.y + p.h);
      }
    }
  }
  items.push(...tokens.values());
  return items.filter((item) => item.text !== '?');
}

// Decides what a row is. Chords are recognised here as well as from marks
// made earlier, so a chart whose chords were never all marked still converts.
function classify(row) {
  const names = chordTokens(row.items, { repair: true });
  row.items.forEach((item, i) => { if (item.chord && isChord(item.text)) names.set(i, item.text); });
  const text = row.items.map((item) => item.text).join(' ');
  row.heading = sectionLabel(text);
  const words = row.items.filter((item, i) => !names.has(i) && !isNeutral(item.text));
  row.chordRow = !row.heading && names.size > 0 && words.length === 0;
  row.chords = row.items.map((item, i) => ({ item, name: names.get(i) })).filter((c) => c.name);
  row.text = text;
}

function mergeChordsIntoLyric(chordRow, lyricRow) {
  let lyric = '';
  const spans = [];
  for (const item of lyricRow.items) {
    if (lyric) lyric += ' ';
    spans.push({ start: lyric.length, length: item.text.length, x0: item.x0, x1: item.x1 });
    lyric += item.text;
  }
  // When the chords are at the foot of one column and the words at the top of
  // the next, positions are compared from each column's own left edge.
  const shift = (lyricRow.left ?? 0) - (chordRow.left ?? 0);
  const inserts = chordRow.chords.map(({ item: placed, name }) => {
    const item = { x0: placed.x0 + shift };
    const span = spans.find((s) => s.x1 > item.x0);
    if (!span) return { index: lyric.length, name, pad: true };
    if (item.x0 <= span.x0) return { index: span.start, name };
    // Charts place chords by eye, a character or so off the word they belong
    // to. A chord that starts just inside a word goes to its beginning; one
    // over its last letter or its punctuation goes to the word after.
    const into = Math.round(((item.x0 - span.x0) / (span.x1 - span.x0)) * span.length);
    if (into <= 1) return { index: span.start, name };
    if (into >= span.length - 1) {
      const following = spans[spans.indexOf(span) + 1];
      return following ? { index: following.start, name } : { index: lyric.length, name, pad: true };
    }
    return { index: span.start + into, name };
  });
  for (const insert of inserts.reverse()) {
    lyric = `${lyric.slice(0, insert.index)}${insert.pad ? ' ' : ''}[${insert.name}]${lyric.slice(insert.index)}`;
  }
  return lyric;
}

/**
 * Writes the song's recognised text as ChordPro. The song is read as one
 * stream of rows: down each column, column after column, page after page.
 * Chord rows are folded into the lyric lines beneath them (even when the
 * lyric line is at the top of the next column or page), and headings go on
 * their own lines. Returns null if no text is known.
 */
export function exportChordPro(pages, fallbackTitle) {
  // 1. Every row of the song, in reading order.
  const perPage = pages.map((page) => pageItems(page));
  const gutterList = guttersOfPages(pages.map((page, i) => ({ items: perPage[i], width: page.w })));
  const stream = [];
  pages.forEach((page, pageIndex) => {
    const items = perPage[pageIndex];
    if (!items.length) return;
    const typical = median(items.map((item) => item.y1 - item.y0)) || 10;
    inColumns(items, gutterList[pageIndex]).forEach((column, columnIndex) => {
      const left = Math.min(...column.map((item) => item.x0));
      for (const row of rowsOf(column)) {
        classify(row);
        // Page numbers in the top or bottom margin are not part of the song.
        const margin = row.y0 > page.h * 0.9 || row.y1 < page.h * 0.07;
        if (margin && /^(page\s*)?\d{1,3}(\s*(\/|of)\s*\d{1,3})?$/i.test(row.text.trim())) continue;
        row.column = `${pageIndex}:${columnIndex}`;
        row.left = left;
        row.typical = typical;
        stream.push(row);
      }
    });
  });
  if (!stream.length) return null;

  // Rows that follow one another closely: next to each other in a column, or
  // the last row of one column and the first of the next.
  const follows = (above, below) => above.column !== below.column || below.y0 - above.y1 < 1.6 * above.typical;

  const out = [];
  let title = null, previous = null;
  for (let i = 0; i < stream.length; i++) {
    const row = stream[i];
    // A first line set much larger than the rest is the song's title.
    if (i === 0 && !row.heading && !row.chordRow && row.y1 - row.y0 >= 1.4 * row.typical) { title = row.text; continue; }
    if (row.heading) {
      if (out.length && out[out.length - 1] !== '') out.push('');
      out.push(row.heading);
      previous = row;
      continue;
    }
    // A gap within a column is a blank line; the jump to a new column is not.
    if (previous && !previous.heading && previous.column === row.column && row.y0 - previous.y1 > 1.3 * row.typical && out[out.length - 1] !== '') out.push('');
    if (!row.chordRow) {
      out.push(row.text);
      previous = row;
      continue;
    }
    // A long line that was wrapped has its chords wrapped too: two chord rows
    // stacked above two lyric lines. Each chord row belongs to the lyric line
    // in the same position, so they are paired off in order.
    const chordRows = [row];
    while (stream[i + chordRows.length]?.chordRow && follows(chordRows[chordRows.length - 1], stream[i + chordRows.length])) chordRows.push(stream[i + chordRows.length]);
    const lyricRows = [];
    for (let k = i + chordRows.length; lyricRows.length < chordRows.length; k++) {
      const candidate = stream[k];
      const above = lyricRows[lyricRows.length - 1] || chordRows[chordRows.length - 1];
      if (!candidate || candidate.chordRow || candidate.heading || !follows(above, candidate)) break;
      lyricRows.push(candidate);
    }
    const alone = (chordRow) => chordRow.items.map((item) => { const c = chordRow.chords.find((x) => x.item === item); return c ? `[${c.name}]` : item.text; }).join(' ');
    // More chord rows than lyric lines: the extra ones at the top stand by themselves.
    const spare = chordRows.length - lyricRows.length;
    chordRows.slice(0, spare).forEach((chordRow) => out.push(alone(chordRow)));
    lyricRows.forEach((lyricRow, n) => out.push(mergeChordsIntoLyric(chordRows[spare + n], lyricRow)));
    previous = lyricRows[lyricRows.length - 1] || chordRows[chordRows.length - 1];
    i += chordRows.length + lyricRows.length - 1;
  }
  const body = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!body && !title) return null;
  return `{title: ${title || fallbackTitle}}\n\n${body.split('\n').map((line) => (headingOf(line) ? `{comment: ${headingOf(line)}}` : line)).join('\n')}\n`;
}
