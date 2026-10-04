// Prints the editable-text version of a saved song, as "Turn this chart into
// editable text" would produce it. For checking the conversion on a real song.
// Usage: node scripts/song-to-text.mjs "<file.chartshift>"
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { exportChordPro } from '../src/lib/chordpro.js';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/song-to-text.mjs <file.chartshift>'); process.exit(1); }
const zip = await JSZip.loadAsync(readFileSync(file));
const song = JSON.parse(await zip.file('song.json').async('string'));
if (song.pages.some((page) => page.pieces.some((p) => p.kind === 'text'))) console.error('(note: typed text boxes are skipped here; they need the app to be measured)');
const pages = song.pages.map((page) => ({ ...page, pieces: page.pieces.filter((p) => p.kind !== 'text') }));
console.log(exportChordPro(pages, 'Untitled') ?? '(no recognised text in this song)');
