// Reads the notes out of a MusicXML file, for comparing music readers.

const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** Notes from a MusicXML file: { staff (1 = top), measure (1-based), midi }. */
export function notesOfMusicXml(xml) {
  const notes = [];
  const parts = xml.split(/<part[ >]/).slice(1);
  let staffBase = 0;
  for (const part of parts) {
    let measure = 0, maxStaff = 1;
    for (const m of part.split(/<measure\b/).slice(1)) {
      measure++;
      for (const n of m.split(/<note\b/).slice(1)) {
        const body = n.split('</note>')[0];
        if (/<rest\b/.test(body) || /<grace\b/.test(body)) continue;
        const step = (body.match(/<step>([A-G])<\/step>/) || [])[1];
        const octave = Number((body.match(/<octave>(-?\d+)<\/octave>/) || [])[1]);
        if (!step || Number.isNaN(octave)) continue;
        const alter = Number((body.match(/<alter>(-?\d+)<\/alter>/) || [])[1] || 0);
        const staff = Number((body.match(/<staff>(\d+)<\/staff>/) || [])[1] || 1);
        maxStaff = Math.max(maxStaff, staff);
        notes.push({ staff: staffBase + staff, measure, midi: 12 * (octave + 1) + STEP[step] + alter });
      }
    }
    staffBase += maxStaff;
  }
  return notes;
}
