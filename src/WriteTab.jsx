// The Write tab: a song as text. Type the words, put chords in [brackets],
// and the page is laid out as you go.
import { useRef, useState } from 'react';
import { chordsInKey } from './lib/chords.js';
import { deleteSection, duplicateSection, lineSyllables, moveSection, nextHeading, parseStructure } from './lib/songtext.js';
import { INSTRUMENTS } from './lib/diagrams.js';
import { Icon } from './icons.jsx';
import { IconButton } from './ui.jsx';

export const KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
export const TIMES = ['4/4', '3/4', '6/8', '2/4', '12/8'];
const SECTION_KINDS = ['Verse', 'Chorus', 'Pre-Chorus', 'Bridge', 'Intro', 'Outro', 'Tag', 'Instrumental'];

export function KeySelect({ value, onChange, id }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Not set</option>
      <optgroup label="Major">{KEYS.map((k) => <option key={k} value={k}>{k}</option>)}</optgroup>
      <optgroup label="Minor">{KEYS.map((k) => <option key={`${k}m`} value={`${k}m`}>{k}m</option>)}</optgroup>
    </select>
  );
}

function Facts({ editor, write }) {
  const set = (name, value) => editor.setWrite({ meta: { [name]: value } });
  return (
    <details className="more" open>
      <summary><Icon name="chevronDown" />Song details</summary>
      <div className="stack">
        <label className="field">Title
          <input type="text" value={write.meta.title} maxLength={120} onChange={(e) => set('title', e.target.value)} />
        </label>
        <label className="field">Written by
          <input type="text" value={write.meta.artist} maxLength={120} onChange={(e) => set('artist', e.target.value)} />
        </label>
        <div className="row bottom">
          <label className="field grow">Key
            <KeySelect value={write.meta.key} onChange={(v) => set('key', v)} />
          </label>
          <label className="field grow">Time
            <select value={write.meta.time} onChange={(e) => set('time', e.target.value)}>
              <option value="">Not set</option>
              {TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        </div>
        <div className="row bottom">
          <label className="field grow">Tempo (beats a minute)
            <input type="number" min="30" max="300" value={write.meta.tempo} onChange={(e) => set('tempo', e.target.value.slice(0, 3))} />
          </label>
          <label className="field grow">Capo (fret)
            <input type="number" min="0" max="11" value={write.meta.capo} onChange={(e) => set('capo', e.target.value === '0' ? '' : e.target.value.slice(0, 2))} />
          </label>
        </div>
      </div>
    </details>
  );
}

function Drafts({ editor, write }) {
  const [name, setName] = useState('');
  return (
    <details className="more">
      <summary><Icon name="chevronDown" />Drafts ({write.drafts.length})</summary>
      <div className="stack">
        <p className="muted">A draft is a copy of the words as they are now. Go back to one at any time; they are saved with the song.</p>
        <form className="row bottom" onSubmit={(e) => { e.preventDefault(); editor.saveDraft(name); setName(''); }}>
          <label className="field grow">Name for this draft
            <input type="text" value={name} maxLength={80} placeholder={`Draft ${write.drafts.length + 1}`} onChange={(e) => setName(e.target.value)} />
          </label>
          <button type="submit" className="btn outline">Keep a draft</button>
        </form>
        {write.drafts.length > 0 && (
          <ul className="draft-list">
            {write.drafts.map((draft, i) => (
              <li key={`${draft.saved}-${i}`}>
                <span className="grow"><strong>{draft.name}</strong><br /><span className="muted">{new Date(draft.saved).toLocaleString()}</span></span>
                <button type="button" className="btn outline" onClick={() => editor.restoreDraft(i)} aria-label={`Go back to draft ${draft.name}`}>Go back to this</button>
                <IconButton icon="trash" label={`Delete draft ${draft.name}`} onClick={() => editor.deleteDraft(i)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

export function WriteTab({ editor, state, onConvert, onListen }) {
  const write = state.write;
  const area = useRef(null);
  const gutter = useRef(null);
  const [caretLine, setCaretLine] = useState(0);

  if (!write) {
    return (
      <div className="group">
        <p>This chart was opened from a PDF or picture, so its pieces are moved around rather than typed.</p>
        <p className="muted">If its text has been read, you can turn it into a song you can type in. That makes a new song; this chart is left as it is.</p>
        <button type="button" className="btn outline block" onClick={onConvert}><Icon name="edit" />Turn this chart into editable text</button>
      </div>
    );
  }

  const lines = write.text.split('\n');
  const counts = lines.map(lineSyllables);
  const palette = chordsInKey(editor.writtenKey());

  // Typing lays the page out afresh, which would undo pieces moved by hand.
  const allowed = () => !state.layoutEdited
    || window.confirm('You moved things on the page by hand. Changing the text lays the page out again and puts them back. Carry on?');
  const change = (text) => { if (allowed()) editor.setWrite({ text }); };

  const noteCaret = () => {
    const el = area.current;
    if (el) setCaretLine(el.value.slice(0, el.selectionStart).split('\n').length - 1);
  };
  // Puts text in at the cursor and leaves the cursor after it.
  const insert = (snippet) => {
    const el = area.current;
    if (!allowed()) return;
    const start = el.selectionStart, end = el.selectionEnd;
    editor.setWrite({ text: write.text.slice(0, start) + snippet + write.text.slice(end) });
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + snippet.length, start + snippet.length); noteCaret(); });
  };
  const addSection = (kind) => {
    if (!kind || !allowed()) return;
    const heading = nextHeading(write.text, kind);
    const text = `${write.text.replace(/\s+$/, '')}${write.text.trim() ? '\n\n' : ''}${heading}\n`;
    editor.setWrite({ text });
    requestAnimationFrame(() => { const el = area.current; el.focus(); el.setSelectionRange(text.length, text.length); el.scrollTop = el.scrollHeight; noteCaret(); });
  };

  const here = counts[caretLine];
  return (
    <>
      <div className="group"><Facts editor={editor} write={write} /></div>

      <div className="group">
        <h3>Words and chords</h3>
        <p className="muted" id="write-help">Put a chord in square brackets where it is played: <code>[G]Amazing [C]grace</code>. A line such as <code>Verse 1</code> or <code>Chorus</code> on its own starts a section.</p>
        {palette.length > 0 ? (
          <div className="palette" role="group" aria-label="Chords in this key">
            {palette.map((chord) => (
              <button key={chord.name} type="button" className="btn outline chord-key" onClick={() => insert(`[${chord.name}]`)}
                aria-label={`Insert chord ${chord.name}, number ${chord.number}`} title={`Insert [${chord.name}] at the cursor`}>
                <strong>{chord.name}</strong><span>{chord.number}</span>
              </button>
            ))}
          </div>
        ) : <p className="muted">Choose a key under Song details to get its chords as buttons here.</p>}
        <div className="write-box">
          <div className="syllables" ref={gutter} aria-hidden="true">
            {counts.map((count, i) => <span key={i} className={i === caretLine ? 'current' : undefined}>{count ?? ''}</span>)}
          </div>
          <textarea ref={area} value={write.text} wrap="off" spellCheck aria-label="Song words and chords" aria-describedby="write-help"
            onChange={(e) => change(e.target.value)} onScroll={(e) => { gutter.current.scrollTop = e.target.scrollTop; }}
            onSelect={noteCaret} onKeyUp={noteCaret} onClick={noteCaret} />
        </div>
        <p className="muted">
          {here != null ? `Line ${caretLine + 1}: about ${here} syllable${here === 1 ? '' : 's'}.` : 'The numbers beside each line are a rough syllable count.'}
        </p>
        <button type="button" className="btn outline block" onClick={onListen}><Icon name="mic" />Chords from a recording… <span className="badge">Experimental</span></button>
        <label className="field">Add a section
          <select value="" onChange={(e) => addSection(e.target.value)}>
            <option value="">Choose…</option>
            {SECTION_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
          </select>
        </label>
      </div>

      <div className="group">
        <h3>Page</h3>
        <label className="field">Columns
          <select value={write.columns === 2 ? '2' : '1'} onChange={(e) => editor.setWrite({ columns: Number(e.target.value) })}>
            <option value="1">One column</option>
            <option value="2">Two columns (fits about twice as much on a page)</option>
          </select>
        </label>
        <label className="field">Chord diagrams at the top of the song
          <select value={write.diagrams || ''} onChange={(e) => editor.setWrite({ diagrams: e.target.value || null })}>
            <option value="">None</option>
            {Object.entries(INSTRUMENTS).map(([id, spec]) => <option key={id} value={id}>{spec.label}</option>)}
          </select>
        </label>
      </div>

      <div className="group"><Drafts editor={editor} write={write} /></div>
    </>
  );
}

/** The song's sections as a list that can be reordered; works on the text. */
export function StructureList({ editor, state }) {
  const { text } = state.write;
  const { sections } = parseStructure(text);
  const apply = (next, status) => {
    if (state.layoutEdited && !window.confirm('You moved things on the page by hand. Changing the song’s order lays the page out again and puts them back. Carry on?')) return;
    editor.setWrite({ text: next }, status);
  };
  return (
    <>
      <div className="group">
        <h3>Song structure</h3>
        {sections.length ? (
          <ol className="section-list">
            {sections.map((section, i) => {
              const kind = /^verse/i.test(section.label) ? 'verse' : /^(chorus|refrain)/i.test(section.label) ? 'chorus' : /^(bridge|pre)/i.test(section.label) ? 'bridge' : 'other';
              const words = section.lines.slice(1).filter((l) => l.trim()).length;
              return (
                <li key={`${i}-${section.label}`} className={`section-row ${kind}`}>
                  <div className="row">
                    <span className="grow"><strong>{section.label}</strong> <span className="muted">· {words} line{words === 1 ? '' : 's'}</span></span>
                    <IconButton icon="arrowUp" label={`Move ${section.label} earlier`} disabled={i === 0} onClick={() => apply(moveSection(text, i, -1), `“${section.label}” moved earlier.`)} />
                    <IconButton icon="arrowDown" label={`Move ${section.label} later`} disabled={i === sections.length - 1} onClick={() => apply(moveSection(text, i, 1), `“${section.label}” moved later.`)} />
                    <IconButton icon="duplicate" label={`Repeat ${section.label}`} onClick={() => apply(duplicateSection(text, i), `“${section.label}” repeated.`)} />
                    <IconButton icon="trash" label={`Delete ${section.label}`} className="danger" onClick={() => apply(deleteSection(text, i), `“${section.label}” deleted.`)} />
                  </div>
                </li>
              );
            })}
          </ol>
        ) : <p className="empty">No sections yet. On the Write tab, put a heading such as “Verse 1” or “Chorus” on a line of its own.</p>}
        <p className="muted">Reordering here rewrites the song’s text; the page follows.</p>
      </div>
    </>
  );
}
