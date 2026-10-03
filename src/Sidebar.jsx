import { useId, useState } from 'react';
import { KEY_CHOICES, keyName } from './lib/chords.js';

const SECTION_NAMES = ['Verse 1', 'Verse 2', 'Verse 3', 'Chorus', 'Pre-Chorus', 'Bridge', 'Intro', 'Outro', 'Tag', 'Instrumental', 'Ending'];

function Panel({ title, children, open = true }) {
  return (
    <details className="panel" open={open}>
      <summary><h2>{title}</h2></summary>
      <div className="panel-body">{children}</div>
    </details>
  );
}

function SectionRow({ editor, pageIndex, section, index, count }) {
  const [label, setLabel] = useState(section.label);
  const rename = () => {
    const next = label.trim();
    if (next && next !== section.label) editor.renameSection(pageIndex, section.id, next);
    else setLabel(section.label);
  };
  const name = section.label;
  return (
    <li className="section-row">
      <input type="text" value={label} aria-label={`Name of section ${index + 1}`} maxLength={40}
        onChange={(e) => setLabel(e.target.value)} onBlur={rename}
        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} />
      <div className="row wrap">
        <button type="button" onClick={() => editor.selectSection(pageIndex, section.id)} aria-label={`Select ${name}`}>Select</button>
        <button type="button" disabled={index === 0} onClick={() => editor.moveSection(pageIndex, section.id, -1)} aria-label={`Move ${name} up`}>Up</button>
        <button type="button" disabled={index === count - 1} onClick={() => editor.moveSection(pageIndex, section.id, 1)} aria-label={`Move ${name} down`}>Down</button>
        <button type="button" onClick={() => editor.duplicateSection(pageIndex, section.id)} aria-label={`Repeat ${name} below`}>Repeat</button>
        <button type="button" onClick={() => editor.ungroupSection(pageIndex, section.id)} aria-label={`Ungroup ${name}`}>Ungroup</button>
        <button type="button" onClick={() => editor.deleteSection(pageIndex, section.id)} aria-label={`Delete ${name} and close the gap`}>Delete</button>
      </div>
    </li>
  );
}

function Sections({ editor, state }) {
  const [label, setLabel] = useState('Verse 1');
  const listId = useId();
  const pageIndex = state.activePage;
  const sections = editor.sectionList(pageIndex);
  return (
    <Panel title="Sections">
      <label className="field">New section name
        <input type="text" list={listId} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} />
      </label>
      <datalist id={listId}>{SECTION_NAMES.map((n) => <option key={n} value={n} />)}</datalist>
      <button type="button" disabled={!state.selection.size || !label.trim()} onClick={() => editor.makeSection(label.trim())}>
        Make section from selection
      </button>
      <button type="button" onClick={editor.autoSections}>Find sections from headings</button>
      <h3>On page {pageIndex + 1}</h3>
      {sections.length ? (
        <ol className="section-list">
          {sections.map((s, i) => <SectionRow key={`${s.id}:${s.label}`} editor={editor} pageIndex={pageIndex} section={s} index={i} count={sections.length} />)}
        </ol>
      ) : <p className="muted">No sections yet. Drag a box around some lines, then make them a section.</p>}
    </Panel>
  );
}

function Chords({ editor, state, onReadText, onReview }) {
  const chords = editor.chordList();
  const key = editor.songKey();
  const [spelling, setSpelling] = useState('auto');
  const [target, setTarget] = useState('');
  const [capo, setCapo] = useState(2);
  const [mark, setMark] = useState('');
  // A page is unread (a scan) when most of its pieces have no recognised text.
  const unread = state.pages.some((page) => {
    const clips = page.pieces.filter((p) => p.kind === 'clip');
    return clips.length > 0 && clips.filter((p) => p.t).length < clips.length / 2;
  });
  const toKey = () => {
    if (target === '' || !key) return;
    let steps = (Number(target) - key.index + 12) % 12;
    if (steps > 6) steps -= 12;
    if (steps) editor.transpose(steps, spelling);
  };
  return (
    <Panel title="Chords">
      <p className="fact" aria-live="polite">
        {chords.length ? `${chords.length} chords found. Key: ${key ? keyName(key) : 'unknown'}.` : 'No chords found yet.'}
      </p>
      {unread && (
        <button type="button" onClick={onReadText}>Read text from scan</button>
      )}
      <button type="button" onClick={onReview} disabled={!chords.length}>Check the chords…</button>
      <h3>Transpose</h3>
      <div className="row">
        <button type="button" disabled={!chords.length} onClick={() => editor.transpose(-1, spelling)} aria-label="Transpose down a half step">− Half step</button>
        <button type="button" disabled={!chords.length} onClick={() => editor.transpose(1, spelling)} aria-label="Transpose up a half step">+ Half step</button>
      </div>
      <div className="row">
        <label className="field grow">To key
          <select value={target} onChange={(e) => setTarget(e.target.value)} disabled={!chords.length}>
            <option value="">Choose…</option>
            {KEY_CHOICES.map((k) => <option key={k.index} value={k.index}>{k.name}{key?.minor ? 'm' : ''}</option>)}
          </select>
        </label>
        <button type="button" disabled={!chords.length || target === ''} onClick={toKey}>Change key</button>
      </div>
      <label className="field">Write accidentals as
        <select value={spelling} onChange={(e) => setSpelling(e.target.value)}>
          <option value="auto">Whatever suits the key</option>
          <option value="sharps">Sharps (#)</option>
          <option value="flats">Flats (b)</option>
        </select>
      </label>
      <h3>Capo</h3>
      <div className="row">
        <label className="field grow">Fret
          <input type="number" min="1" max="11" value={capo} onChange={(e) => setCapo(Math.max(1, Math.min(11, Number(e.target.value) || 1)))} />
        </label>
        <button type="button" disabled={!chords.length} onClick={() => editor.capo(capo)}>Show capo shapes</button>
      </div>
      <h3>Other</h3>
      <button type="button" disabled={!chords.length} onClick={editor.nashville}>Change to Nashville numbers</button>
      <div className="row">
        <label className="field grow">Selected piece is the chord
          <input type="text" value={mark} onChange={(e) => setMark(e.target.value)} placeholder="e.g. Em7" maxLength={16} spellCheck={false} />
        </label>
        <button type="button" disabled={!state.selection.size || !mark.trim()} onClick={() => editor.markChord(mark)}>Mark</button>
      </div>
      <button type="button" disabled={!state.selection.size} onClick={() => editor.markChord('')}>Selection is not a chord</button>
      <label className="check">
        <input type="checkbox" checked={state.showChords} onChange={(e) => editor.set({ showChords: e.target.checked })} />
        Underline chords on the page
      </label>
    </Panel>
  );
}

function Layout({ editor, onChordPro }) {
  return (
    <Panel title="Page and export">
      <button type="button" onClick={editor.fitOnePage}>Fit song on one page</button>
      <button type="button" onClick={editor.largePrint}>Large print (bigger, more pages)</button>
      <button type="button" onClick={editor.removeSpecks}>Remove stray specks</button>
      <button type="button" onClick={onChordPro}>Export as ChordPro (.cho)</button>
    </Panel>
  );
}

export function Sidebar({ editor, state, onReadText, onReview, onChordPro }) {
  return (
    <aside className="sidebar" aria-label="Song tools">
      <Sections editor={editor} state={state} />
      <Chords editor={editor} state={state} onReadText={onReadText} onReview={onReview} />
      <Layout editor={editor} onChordPro={onChordPro} />
    </aside>
  );
}
