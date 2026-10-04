// The inspector: song-level tools grouped under three tabs, with the common
// actions up front and the rarely used ones folded away.
import { useId, useState } from 'react';
import { KEY_CHOICES, keyName } from './lib/chords.js';
import { unreadWords } from './lib/textlayer.js';
import { Icon } from './icons.jsx';
import { IconButton, Menu, TabPanel, Tabs } from './ui.jsx';
import { StructureList, WriteTab } from './WriteTab.jsx';

const SECTION_NAMES = ['Verse 1', 'Verse 2', 'Verse 3', 'Chorus', 'Pre-Chorus', 'Bridge', 'Intro', 'Outro', 'Tag', 'Instrumental', 'Ending'];
const TABS = [
  { id: 'write', label: 'Write', icon: 'edit' },
  { id: 'sections', label: 'Sections', icon: 'sections' },
  { id: 'chords', label: 'Chords', icon: 'music' },
  { id: 'page', label: 'Page', icon: 'page' },
];
const PREFIX = 'inspector';

// Matches the outline colours drawn on the page (see render.js).
const sectionKind = (label) => (/^verse/i.test(label) ? 'verse' : /^(chorus|refrain)/i.test(label) ? 'chorus' : /^(bridge|pre)/i.test(label) ? 'bridge' : 'other');

function SectionRow({ editor, pageIndex, section, index, count }) {
  const [label, setLabel] = useState(section.label);
  const rename = () => {
    const next = label.trim();
    if (next && next !== section.label) editor.renameSection(pageIndex, section.id, next);
    else setLabel(section.label);
  };
  const name = section.label;
  return (
    <li className={`section-row ${sectionKind(name)}`}>
      <input type="text" value={label} aria-label={`Name of section ${index + 1}`} maxLength={40}
        onChange={(e) => setLabel(e.target.value)} onBlur={rename}
        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} />
      <div className="row">
        <button type="button" className="btn outline" onClick={() => editor.selectSection(pageIndex, section.id)} aria-label={`Select ${name}`}>Select</button>
        <span className="grow" />
        <IconButton icon="arrowUp" label={`Move ${name} up`} disabled={index === 0} onClick={() => editor.moveSection(pageIndex, section.id, -1)} />
        <IconButton icon="arrowDown" label={`Move ${name} down`} disabled={index === count - 1} onClick={() => editor.moveSection(pageIndex, section.id, 1)} />
        <IconButton icon="duplicate" label={`Repeat ${name} below`} onClick={() => editor.duplicateSection(pageIndex, section.id)} />
        <Menu label={`More actions for ${name}`} items={[
          { label: 'Ungroup (keep the contents)', onSelect: () => editor.ungroupSection(pageIndex, section.id) },
          { label: 'Delete and close the gap', icon: 'trash', danger: true, onSelect: () => editor.deleteSection(pageIndex, section.id) },
        ]} />
      </div>
    </li>
  );
}

function Sections({ editor, state }) {
  const [label, setLabel] = useState('Verse 1');
  const listId = useId();
  const pageIndex = state.activePage;
  const sections = editor.sectionList(pageIndex);
  const selected = state.selection.size > 0;
  return (
    <>
      <div className="group">
        <h3>New section</h3>
        <label className="field">Name
          <input type="text" list={listId} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} />
        </label>
        <datalist id={listId}>{SECTION_NAMES.map((n) => <option key={n} value={n} />)}</datalist>
        <button type="button" className="btn primary block" disabled={!selected || !label.trim()} onClick={() => editor.makeSection(label.trim())}>
          Make section from selection
        </button>
        {!selected && <p className="muted">Select the lines on the page first: drag a box around them.</p>}
        <button type="button" className="btn outline block" onClick={editor.autoSections}>Find sections from headings</button>
      </div>
      <div className="group">
        <h3>On page {pageIndex + 1}</h3>
        {sections.length ? (
          <ol className="section-list">
            {sections.map((s, i) => <SectionRow key={`${s.id}:${s.label}`} editor={editor} pageIndex={pageIndex} section={s} index={i} count={sections.length} />)}
          </ol>
        ) : <p className="empty">No sections on this page yet.</p>}
      </div>
    </>
  );
}

function Chords({ editor, state, onReadText, onReview }) {
  const written = !!state.write;
  const chords = editor.chordList();
  const key = editor.songKey();
  const [spelling, setSpelling] = useState('auto');
  const [target, setTarget] = useState('');
  const [capo, setCapo] = useState(2);
  const [mark, setMark] = useState('');
  const none = !chords.length;
  // A page is unread (a scan) when most of its pieces have no recognised text.
  const unread = state.pages.some((page) => {
    const clips = page.pieces.filter((p) => p.kind === 'clip');
    return clips.length > 0 && clips.filter((p) => p.t).length < clips.length / 2;
  });
  // Words on an otherwise readable page that have no text (the PDF did not provide any).
  const missed = !unread && state.pages.some((page) => unreadWords(page.pieces) >= 3);
  const toKey = () => {
    if (target === '' || !key) return;
    let steps = (Number(target) - key.index + 12) % 12;
    if (steps > 6) steps -= 12;
    if (steps) editor.transpose(steps, spelling);
  };
  return (
    <>
      <div className="group">
        <p className="fact" aria-live="polite">
          {none ? 'No chords found yet.' : <><strong>{key ? `Key of ${keyName(key)}` : 'Key unknown'}</strong> <span className="muted">· {chords.length} chords</span></>}
        </p>
        {unread && (
          <div className="callout">
            <p>This looks like a scan. Read its text so the chords can be found.</p>
            <button type="button" className="btn primary block" onClick={onReadText}><Icon name="scan" />Read text from scan</button>
          </div>
        )}
        {missed && (
          <div className="callout">
            <p>Some words on the page have no text behind them, so chords among them cannot be found.</p>
            <button type="button" className="btn outline block" onClick={onReadText}><Icon name="scan" />Read the missed text</button>
          </div>
        )}
        {!written && <button type="button" className="btn outline block" onClick={onReview} disabled={none}>Check the chords…</button>}
        {written && <p className="muted">Changing the key rewrites the chords in the song’s text.</p>}
      </div>
      <div className="group">
        <h3>Transpose</h3>
        <div className="row">
          <button type="button" className="btn outline grow" disabled={none} onClick={() => editor.transpose(-1, spelling)} aria-label="Transpose down a half step"><Icon name="minus" />Half step</button>
          <button type="button" className="btn outline grow" disabled={none} onClick={() => editor.transpose(1, spelling)} aria-label="Transpose up a half step"><Icon name="plus" />Half step</button>
        </div>
        <div className="row bottom">
          <label className="field grow">To key
            <select value={target} onChange={(e) => setTarget(e.target.value)} disabled={none}>
              <option value="">Choose…</option>
              {KEY_CHOICES.map((k) => <option key={k.index} value={k.index}>{k.name}{key?.minor ? 'm' : ''}</option>)}
            </select>
          </label>
          <button type="button" className="btn outline" disabled={none || target === ''} onClick={toKey}>Change key</button>
        </div>
      </div>
      <div className="group">
        <h3>Capo</h3>
        <div className="row bottom">
          <label className="field grow">Fret
            <input type="number" min="1" max="11" value={capo} onChange={(e) => setCapo(Math.max(1, Math.min(11, Number(e.target.value) || 1)))} />
          </label>
          <button type="button" className="btn outline" disabled={none} onClick={() => editor.capo(capo)}>Show capo shapes</button>
        </div>
      </div>
      <div className="group">
        <details className="more">
          <summary><Icon name="chevronDown" />More chord tools</summary>
          <div className="stack">
            <label className="field">Write sharps and flats as
              <select value={spelling} onChange={(e) => setSpelling(e.target.value)}>
                <option value="auto">Whatever suits the key</option>
                <option value="sharps">Sharps (#)</option>
                <option value="flats">Flats (b)</option>
              </select>
            </label>
            <button type="button" className="btn outline block" disabled={none} onClick={editor.nashville}>Change to Nashville numbers</button>
            {!written && <div className="row bottom">
              <label className="field grow">Selected piece is the chord
                <input type="text" value={mark} onChange={(e) => setMark(e.target.value)} placeholder="e.g. Em7" maxLength={16} spellCheck={false} />
              </label>
              <button type="button" className="btn outline" disabled={!state.selection.size || !mark.trim()} onClick={() => editor.markChord(mark)}>Mark</button>
            </div>}
            {!written && <button type="button" className="btn outline block" disabled={!state.selection.size} onClick={() => editor.markChord('')}>Selection is not a chord</button>}
            {!written && (
              <label className="check">
                <input type="checkbox" checked={state.showChords} onChange={(e) => editor.set({ showChords: e.target.checked })} />
                Underline chords on the page
              </label>
            )}
          </div>
        </details>
      </div>
    </>
  );
}

function PageTools({ editor, onPdf, onPrint, onChordPro }) {
  return (
    <>
      <div className="group">
        <h3>Layout</h3>
        <button type="button" className="btn outline block" onClick={editor.fitOnePage}>Fit song on one page</button>
        <button type="button" className="btn outline block" onClick={editor.largePrint}>Large print</button>
        <p className="muted">Large print enlarges everything and adds pages as needed.</p>
      </div>
      <div className="group">
        <h3>Clean up</h3>
        <button type="button" className="btn outline block" onClick={editor.removeSpecks}>Remove stray specks</button>
      </div>
      <div className="group">
        <h3>Export</h3>
        <button type="button" className="btn outline block" onClick={onPdf}><Icon name="pdf" />Save as PDF</button>
        <button type="button" className="btn outline block" onClick={onPrint}><Icon name="print" />Print preview…</button>
        <button type="button" className="btn outline block" onClick={onChordPro}>Export as ChordPro (.cho)</button>
      </div>
    </>
  );
}

export function Inspector({ editor, state, tab, onTab, onReadText, onReview, onPdf, onPrint, onChordPro, onConvert, onListen }) {
  return (
    <aside className={`inspector${tab === 'write' && state.write ? ' wide' : ''}`} aria-label="Song tools">
      <h2 className="sr-only">Song tools</h2>
      <Tabs label="Song tools" tabs={TABS} value={tab} onChange={onTab} prefix={PREFIX} />
      <TabPanel prefix={PREFIX} id={tab} className="inspector-body">
        {tab === 'write' && <WriteTab editor={editor} state={state} onConvert={onConvert} onListen={onListen} />}
        {tab === 'sections' && (state.write ? <StructureList editor={editor} state={state} /> : <Sections editor={editor} state={state} />)}
        {tab === 'chords' && <Chords editor={editor} state={state} onReadText={onReadText} onReview={onReview} />}
        {tab === 'page' && <PageTools editor={editor} onPdf={onPdf} onPrint={onPrint} onChordPro={onChordPro} />}
      </TabPanel>
    </aside>
  );
}
