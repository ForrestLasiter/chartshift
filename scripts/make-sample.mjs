// Builds public/sample.pdf: a made-up song with chords over lyrics on page 1
// and a tab staff on page 2, for trying the editor and for testing.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pdf = await PDFDocument.create();
const sans = await pdf.embedFont(StandardFonts.Helvetica);
const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
const mono = await pdf.embedFont(StandardFonts.Courier);

const page = pdf.addPage([612, 792]);
page.drawText('Morning Light (sample)', { x: 72, y: 720, size: 22, font: bold });
page.drawText('Key of G  -  for trying out ChartShift', { x: 72, y: 698, size: 11, font: sans });

const sections = [
  ['[Verse 1]', [
    ['G              C            G', 'Morning light is on the hills again'],
    ['Em             C            D', 'Every shadow starts to fade away'],
  ]],
  ['[Chorus]', [
    ['C          G          D        Em', 'Lift it up, lift it up, let it ring'],
    ['C          G          D        G', 'All together now we sing'],
  ]],
  ['[Verse 2]', [
    ['G              C            G', 'Evening comes and still the song remains'],
    ['Em             C            D', 'Carry it along the road back home'],
  ]],
];
let y = 650;
for (const [title, lines] of sections) {
  page.drawText(title, { x: 72, y, size: 12, font: bold });
  y -= 22;
  for (const [chords, lyric] of lines) {
    page.drawText(chords, { x: 72, y, size: 12, font: mono, color: rgb(0.1, 0.2, 0.7) });
    y -= 15;
    page.drawText(lyric, { x: 72, y, size: 12, font: mono });
    y -= 24;
  }
  y -= 18;
}

const tab = pdf.addPage([612, 792]);
tab.drawText('[Intro]', { x: 72, y: 720, size: 14, font: bold });
const top = 680, gap = 12, left = 72, right = 540;
for (let s = 0; s < 6; s++) {
  tab.drawLine({ start: { x: left, y: top - s * gap }, end: { x: right, y: top - s * gap }, thickness: 0.8 });
}
for (const x of [left, 228, 384, right]) {
  tab.drawLine({ start: { x, y: top }, end: { x, y: top - 5 * gap }, thickness: 0.8 });
}
const notes = [[100, 2, '0'], [130, 2, '2'], [160, 1, '3'], [190, 2, '0'], [256, 3, '2'], [290, 3, '0'], [324, 2, '2'], [356, 1, '0'], [412, 0, '3'], [450, 1, '0'], [490, 2, '0']];
for (const [x, string, fret] of notes) {
  const ny = top - string * gap;
  tab.drawRectangle({ x: x - 2, y: ny - 5, width: 10, height: 10, color: rgb(1, 1, 1) });
  tab.drawText(fret, { x, y: ny - 3.5, size: 10, font: sans });
}
tab.drawText('e|-----0-----0-----|', { x: 72, y: 560, size: 12, font: mono });
tab.drawText('B|---1-----1-----1-|', { x: 72, y: 546, size: 12, font: mono });
tab.drawText('G|-0-----0-----0---|', { x: 72, y: 532, size: 12, font: mono });

mkdirSync(join(root, 'public'), { recursive: true });
writeFileSync(join(root, 'public', 'sample.pdf'), await pdf.save());
console.log('wrote public/sample.pdf');
