// "Read sheet music": what the music reader found, and what to do with it:
// chord names and note names on the page, or a new chord-and-tab sheet.
import { useId, useState } from 'react';
import { Modal } from './dialogs.jsx';
import { Icon } from './icons.jsx';
import { keyName } from './lib/chords.js';
import { sheetText } from './lib/tab.js';

const TIMES = { 2: '2/4', 3: '3/4', 4: '4/4', 6: '6/8' };

/** Puts the readings of several pages together as one piece, for the sheet and the summary. */
export function combineReadings(readings) {
  const measures = [];
  let systems = 0;
  for (const r of readings) {
    for (const m of r.result.measures) measures.push({ ...m, system: systems + m.system, pageIndex: r.pageIndex });
    systems += r.music.systems.length;
  }
  const first = readings.find((r) => r.result.measures.length);
  return { key: first?.result.key || null, beats: first?.result.beats || 0, measures, systems };
}

export function SheetMusicDialog({ readings, title, pageHasChords, onAdd, onMakeSheet, onMakeChart, onClose }) {
  const id = useId();
  const all = combineReadings(readings);
  const notes = all.measures.reduce((n, m) => n + m.onsets.reduce((k, o) => k + o.notes.length, 0), 0);
  const [chords, setChords] = useState(!pageHasChords);
  const [names, setNames] = useState(true);
  const found = all.measures.length > 0;

  // One line of the summary per line of music: its bars and their chords.
  const lines = [];
  for (const m of all.measures) {
    let line = lines[lines.length - 1];
    if (!line || line.system !== m.system) { line = { system: m.system, page: m.pageIndex + 1, bars: [] }; lines.push(line); }
    line.bars.push(m.chords.map((c) => c.name).join(' ') || '–');
  }
  const preview = found ? sheetText({ ...all, measures: all.measures.filter((m) => m.system < 2) }).split('\n').filter((l) => !l.startsWith('{')).join('\n').replace(/^\n+|\s+$/g, '') : '';

  const footer = (
    <>
      {found && <button type="button" className="btn primary" disabled={!chords && !names} onClick={() => onAdd({ chords, notes: names })}>Add to the page</button>}
      {found && <button type="button" className="btn outline" onClick={onMakeChart}>Make a chord chart</button>}
      {found && <button type="button" className="btn outline" onClick={() => onMakeSheet(sheetText(all, { title }))}>Make a chord and tab sheet</button>}
      <button type="button" className="btn outline" onClick={onClose}>{found ? 'Cancel' : 'Close'}</button>
    </>
  );

  return (
    <Modal title="Read sheet music" onClose={onClose} wide footer={footer}>
      <div className="modal-body">
        {!found ? (
          <>
            <p className="fact" role="status"><Icon name="alert" /><span><strong>No music was found.</strong> ChartShift looks for printed staffs (five lines) with notes on them.</span></p>
            <p className="muted">Chord charts and tabs without a staff have nothing for this to read; use “Rescan for chords” for those. Music that is very small, hand-written, or photographed at an angle may not be readable.</p>
          </>
        ) : (
          <>
            <p className="fact" role="status">
              <Icon name="check" />
              <span>
                <strong>{notes} notes on {lines.length} line{lines.length === 1 ? '' : 's'} of music.</strong>
                {' '}{all.key ? `Key of ${keyName(all.key)}` : ''}{TIMES[all.beats] ? ` · ${TIMES[all.beats]}` : ''}
              </span>
            </p>
            <h3 id={`${id}-chords`}>Chords, bar by bar</h3>
            <ol className="sheet-lines" aria-labelledby={`${id}-chords`}>
              {lines.slice(0, 12).map((line) => (
                <li key={line.system}><span className="muted">Line {line.system + 1}{readings.length > 1 ? ` (page ${line.page})` : ''}:</span> <span className="sheet-bars">| {line.bars.join(' | ')} |</span></li>
              ))}
            </ol>
            {lines.length > 12 && <p className="muted">…and {lines.length - 12} more lines.</p>}
            <h3 id={`${id}-tab`}>Tab of the tune (first lines)</h3>
            <pre className="tab-preview" tabIndex={0} aria-labelledby={`${id}-tab`}>{preview.replace(/\[([^\]]+)\]/g, '$1')}</pre>
            <fieldset className="stack">
              <legend>Add to the page</legend>
              <label className="check">
                <input type="checkbox" checked={chords} onChange={(e) => setChords(e.target.checked)} />
                <span>Chord names above each bar{pageHasChords && <><br /><span className="muted">This chart already has chords marked; adding more may double them up.</span></>}</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} />
                <span>Note names under the tune</span>
              </label>
            </fieldset>
            <p className="muted">
              The chords are worked out from the notes, so treat them as a suggestion. Check the notes too: smudges, very small print and
              unusual notation can be misread. “Make a chord chart” reads the verses under the music and starts a new song, verse by verse, with the chords
              over the words. “Make a chord and tab sheet” starts a new song with the chords, note names and tab. This page is not changed either way.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
