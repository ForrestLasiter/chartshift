// Prints what the music reader finds on a page picture, bar by bar.
//   node scripts/omr-bars.mjs page.png
import { readMusic } from '../src/lib/omr.js';
import { analyse } from '../src/lib/sheet.js';
import { readPng } from '../test/helpers/png.mjs';
const music = readMusic(readPng(process.argv[2]));
const r = analyse(music);
console.log('staffs', music.staffs.map((s) => `${s.clef}${s.fifths}`).join(' '), 'systems', music.systems.map((s) => s.staffs.join('+')).join(' '));
r.measures.forEach((m, i) => {
  const parts = m.staffs.map((st) => m.onsets.map((o) => o.notes.filter((n) => n.staff === st).sort((a, b) => b.midi - a.midi).map((n) => `${n.name}${n.octave}${n.hollow ? 'o' : ''}/${n.duration}`).join('+')).filter(Boolean).join(' '));
  console.log(`sys${m.system} bar${i}: ${parts.join('  ||  ')}   chords ${m.chords.map((c) => c.name).join(' ')}`);
});
