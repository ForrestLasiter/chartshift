import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { boundsOf } from './lib/render.js';
import { isChord } from './lib/chords.js';
import { library } from './lib/platform.js';
import { PAPERS, nearestPaper, pageSizes } from './lib/printPlan.js';
import { Icon } from './icons.jsx';
import { IconButton, TabPanel, Tabs } from './ui.jsx';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// A native modal <dialog>: the browser traps Tab inside it, closes it on
// Escape, and returns focus to whatever opened it.
export function Modal({ title, onClose, children, footer, wide }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement;
    if (!dialog.open) dialog.showModal();
    // Start on the first control of the content rather than the Close button.
    dialog.querySelector('.modal-body :is(input, select, button, [tabindex="0"])')?.focus();
    return () => {
      dialog.close();
      // By now React has removed the dialog, so the browser can no longer
      // return focus by itself: put it back on whatever opened the dialog.
      if (opener && opener.isConnected && opener !== document.body) opener.focus();
    };
  }, []);
  return (
    <dialog ref={ref} className={`modal${wide ? ' wide' : ''}`} aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <header className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <IconButton icon="close" label={`Close ${title}`} hint="Close (Esc)" onClick={onClose} />
      </header>
      {children}
      {footer && <footer className="modal-foot">{footer}</footer>}
    </dialog>
  );
}

export function NameDialog({ title, label, initial, action, onSubmit, onClose }) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState('');
  const id = useId();
  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return setError('Type a name first.');
    try { await onSubmit(name.trim()); } catch (err) { setError(err.message); }
  };
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <label className="field" htmlFor={id}>{label}</label>
          <input id={id} type="text" value={name} autoFocus maxLength={120}
            onChange={(e) => { setName(e.target.value); setError(''); }} aria-describedby={error ? `${id}-error` : undefined} />
          {error && <p id={`${id}-error`} className="error" role="alert">{error}</p>}
          <p className="muted">Songs are kept in the library folder so they stay editable.</p>
        </div>
        <footer className="modal-foot">
          <button type="button" className="btn outline" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">{action}</button>
        </footer>
      </form>
    </Modal>
  );
}

// Small picture of a chord as it appears on the page.
function ChordCrop({ entry, atlases }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    const b = boundsOf(entry.pieces);
    const scale = Math.min(4, 30 / Math.max(b.h, 1));
    canvas.width = Math.ceil(b.w * scale) + 8;
    canvas.height = Math.ceil(b.h * scale) + 8;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const p of entry.pieces) {
      if (p.kind === 'text') {
        ctx.fillStyle = p.color;
        ctx.font = `${p.bold ? 'bold ' : ''}${p.size * scale}px ${p.font}`;
        ctx.textBaseline = 'top';
        ctx.fillText(p.text, 4, 4 + p.size * scale * 0.1);
      } else {
        ctx.drawImage(atlases[p.atlas], p.sx, p.sy, p.sw, p.sh, 4 + (p.x - b.x) * scale, 4 + (p.y - b.y) * scale, p.w * scale, p.h * scale);
      }
    }
  }, [entry, atlases]);
  return <canvas ref={ref} className="crop" role="img" aria-label={`How this chord looks on the page (read as ${entry.text})`} />;
}

export function ChordReviewDialog({ editor, onClose }) {
  const chords = useMemo(() => editor.chordList(), [editor]);
  const [values, setValues] = useState(() => new Map(chords.map((c) => [c.key, c.text])));
  const set = (key, value) => setValues((old) => new Map(old).set(key, value));
  const invalid = chords.filter((c) => values.get(c.key) && !isChord(values.get(c.key)));
  const apply = () => {
    const edits = new Map();
    for (const c of chords) if (values.get(c.key) !== c.text) edits.set(c.key, values.get(c.key).trim());
    editor.reviewChords(edits);
    onClose();
  };
  return (
    <Modal title="Check the chords" onClose={onClose} wide
      footer={chords.length ? (
        <>
          <button type="button" className="btn outline" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" onClick={apply} disabled={invalid.length > 0}>Save chords</button>
        </>
      ) : <button type="button" className="btn primary" onClick={onClose}>Close</button>}>
      <div className="modal-body">
        {chords.length ? (
          <>
            <p>Each picture is a chord from the page, next to what ChartShift read. Fix any that are wrong. Clear the box if it is not a chord at all.</p>
            <ul className="review">
              {chords.map((c, i) => (
                <li key={c.key}>
                  <ChordCrop entry={c} atlases={editor.atlases} />
                  <input type="text" value={values.get(c.key)} onChange={(e) => set(c.key, e.target.value)}
                    aria-label={`Chord ${i + 1} of ${chords.length}, page ${c.pageIndex + 1}`}
                    aria-invalid={!!values.get(c.key) && !isChord(values.get(c.key))} spellCheck={false} />
                </li>
              ))}
            </ul>
            {invalid.length > 0 && <p className="error" role="alert">{plural(invalid.length, 'box')}{invalid.length === 1 ? ' is' : 'es are'} not a chord name (outlined in red). Fix or clear {invalid.length === 1 ? 'it' : 'them'}.</p>}
          </>
        ) : (
          <p>No chords have been found yet. For a scanned page, use “Read text from scan” first. You can also select a chord on the page and use “Mark” under More chord tools.</p>
        )}
      </div>
    </Modal>
  );
}

// What happened when library files were copied or imported (see songStore.mergeInto).
function describeMerge(result, verb) {
  const parts = [`${plural(result.copied, 'file')} ${verb}`];
  if (result.identical) parts.push(`${result.identical} already there and identical`);
  if (result.conflicts?.length) {
    parts.push(`${plural(result.conflicts.length, 'file')} had a different version of the same name already there, so both were kept: ${result.conflicts.map((c) => `“${c.savedAs}”`).join(', ')}`);
  }
  return parts.join('; ') + '.';
}

const LIBRARY_TABS = [{ id: 'songs', label: 'Songs' }, { id: 'setlists', label: 'Setlists' }, { id: 'folder', label: 'Folder and sync' }];

export function LibraryDialog({ onClose, onOpenSong, onRenamed, onSetlistPdf, onSetlistPrint, notify }) {
  const [tab, setTab] = useState('songs');
  const [data, setData] = useState({ songs: [], setlists: [] });
  const [info, setInfo] = useState({ dir: '', clouds: [] });
  const [search, setSearch] = useState('');
  const [current, setCurrent] = useState('');
  const [newSetlist, setNewSetlist] = useState('');
  const [renaming, setRenaming] = useState(null);
  const [message, setMessage] = useState('');

  const refresh = async () => {
    setData(await library.list());
    setInfo(await library.info());
  };
  useEffect(() => { refresh(); }, []);
  const say = (text) => { setMessage(text); notify(text); };
  const guard = (task) => async (...args) => {
    try { await task(...args); } catch (error) { say(error.message); }
    await refresh();
  };

  const songs = data.songs.filter((s) => s.name.toLowerCase().includes(search.trim().toLowerCase()));
  const setlist = data.setlists.find((s) => s.name === current) || data.setlists[0];
  const known = new Set(data.songs.map((s) => s.name));

  const removeSong = guard(async (name) => {
    if (!window.confirm(`Move “${name}” to the Recycle Bin?`)) return;
    await library.remove(name);
    say(`“${name}” moved to the Recycle Bin.`);
  });
  const rename = guard(async (from, to) => {
    setRenaming(null);
    if (to && to !== from) { const renamed = await library.rename(from, to); onRenamed?.(from, renamed); say(`Renamed to “${renamed}”.`); }
  });
  const saveSetlist = guard(async (name, list) => { await library.saveSetlist(name, list); });
  const createSetlist = guard(async (e) => {
    e.preventDefault();
    const name = newSetlist.trim();
    if (!name) return;
    if (data.setlists.some((s) => s.name === name)) return say(`A setlist called “${name}” already exists.`);
    await library.saveSetlist(name, []);
    setCurrent(name);
    setNewSetlist('');
    say(`Setlist “${name}” created.`);
  });
  const removeSetlist = guard(async (name) => {
    if (!window.confirm(`Move the setlist “${name}” to the Recycle Bin? The songs in it are kept.`)) return;
    await library.removeSetlist(name);
    setCurrent('');
  });
  const moveInSetlist = (index, direction) => {
    const list = setlist.songs.slice();
    const target = index + direction;
    [list[index], list[target]] = [list[target], list[index]];
    saveSetlist(setlist.name, list);
  };
  const exportAll = guard(async () => {
    const result = await library.exportAll();
    if (result) say(`Exported ${plural(result.count, 'file')} to ${result.path}.`);
  });
  const importAll = guard(async () => {
    const result = await library.importAll();
    if (!result) return;
    const refused = result.rejectedCount
      ? ` ${result.rejectedCount} could not be imported: ${result.rejected.map((r) => `${r.name} (${r.reason})`).join('; ')}${result.rejectedCount > result.rejected.length ? '; …' : ''}.`
      : '';
    say(`Import finished: ${describeMerge(result, 'added')}${refused}`);
  });
  const setFolder = guard(async (cloudPath) => {
    const result = await library.setFolder(cloudPath);
    if (!result) return;
    if (result.unchanged) return say('That is already the library folder.');
    say(`The library folder is now ${result.dir}. ${describeMerge(result, 'copied across')} The previous folder (${result.previous}) was left as it was.`);
  });

  return (
    <Modal title="Song library" onClose={onClose} wide>
      <div className="modal-body">
        <Tabs label="Library" tabs={LIBRARY_TABS} value={tab} onChange={setTab} prefix="library" />

        {tab === 'songs' && (
          <TabPanel prefix="library" id="songs" className="stack">
            <label className="search">
              <span className="sr-only">Search songs</span>
              <Icon name="search" />
              <input type="search" value={search} placeholder="Search songs" onChange={(e) => setSearch(e.target.value)} />
            </label>
            {songs.length ? (
              <ul className="list">
                {songs.map((song) => (
                  <li key={song.name}>
                    {renaming === song.name ? (
                      <form className="row grow" onSubmit={(e) => { e.preventDefault(); rename(song.name, e.target.elements.name.value.trim()); }}>
                        <input className="grow" name="name" type="text" defaultValue={song.name} autoFocus aria-label={`New name for ${song.name}`} maxLength={120} />
                        <button type="submit" className="btn primary">Save name</button>
                        <button type="button" className="btn outline" onClick={() => setRenaming(null)}>Cancel</button>
                      </form>
                    ) : (
                      <>
                        <span className="name">{song.name}<span className="when">{new Date(song.modified).toLocaleDateString()}</span></span>
                        {data.setlists.length > 0 && (
                          <select value="" aria-label={`Add ${song.name} to a setlist`}
                            onChange={(e) => { const s = data.setlists.find((x) => x.name === e.target.value); if (s) { saveSetlist(s.name, [...s.songs, song.name]); say(`Added “${song.name}” to ${s.name}.`); } }}>
                            <option value="">Add to setlist…</option>
                            {data.setlists.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
                          </select>
                        )}
                        <IconButton icon="edit" label={`Rename ${song.name}`} onClick={() => setRenaming(song.name)} />
                        <IconButton icon="trash" label={`Delete ${song.name}`} className="danger" onClick={() => removeSong(song.name)} />
                        <button type="button" className="btn primary" onClick={() => onOpenSong(song.name)} aria-label={`Open ${song.name}`}>Open</button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty">{data.songs.length ? 'No songs match that search.' : 'No songs saved yet. Open a PDF, then use Save to add it here.'}</p>
            )}
          </TabPanel>
        )}

        {tab === 'setlists' && (
          <TabPanel prefix="library" id="setlists" className="stack">
            <form className="row bottom" onSubmit={createSetlist}>
              <label className="field grow">New setlist
                <input type="text" value={newSetlist} onChange={(e) => setNewSetlist(e.target.value)} placeholder="e.g. Sunday 12 October" maxLength={120} />
              </label>
              <button type="submit" className="btn outline">Create</button>
            </form>
            {setlist ? (
              <>
                <label className="field">Setlist
                  <select value={setlist.name} onChange={(e) => setCurrent(e.target.value)}>
                    {data.setlists.map((s) => <option key={s.name} value={s.name}>{s.name} ({s.songs.length})</option>)}
                  </select>
                </label>
                {setlist.songs.length ? (
                  <ol className="list">
                    {setlist.songs.map((name, i) => (
                      <li key={`${name}-${i}`}>
                        <span className="name">{i + 1}. {name}{!known.has(name) && <em className="error"> (missing from the library)</em>}</span>
                        <IconButton icon="arrowUp" label={`Move ${name} earlier`} disabled={i === 0} onClick={() => moveInSetlist(i, -1)} />
                        <IconButton icon="arrowDown" label={`Move ${name} later`} disabled={i === setlist.songs.length - 1} onClick={() => moveInSetlist(i, 1)} />
                        <IconButton icon="close" label={`Remove ${name} from the setlist`} onClick={() => saveSetlist(setlist.name, setlist.songs.filter((_, j) => j !== i))} />
                      </li>
                    ))}
                  </ol>
                ) : <p className="empty">This setlist is empty. Add songs below, in the order you will play them.</p>}
                <label className="field">Add a song
                  <select value="" onChange={(e) => e.target.value && saveSetlist(setlist.name, [...setlist.songs, e.target.value])}>
                    <option value="">Choose a song…</option>
                    {data.songs.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
                  </select>
                </label>
                <div className="row end wrap">
                  <button type="button" className="btn danger" onClick={() => removeSetlist(setlist.name)}>Delete setlist</button>
                  <span className="grow" />
                  <button type="button" className="btn outline" disabled={!setlist.songs.some((n) => known.has(n))} onClick={() => onSetlistPrint(setlist)}><Icon name="print" />Print setlist</button>
                  <button type="button" className="btn primary" disabled={!setlist.songs.some((n) => known.has(n))} onClick={() => onSetlistPdf(setlist)}><Icon name="pdf" />Save as one PDF</button>
                </div>
              </>
            ) : <p className="empty">No setlists yet. Create one above, then add songs to it.</p>}
          </TabPanel>
        )}

        {tab === 'folder' && (
          <TabPanel prefix="library" id="folder" className="stack">
            <h3>Where songs are kept</h3>
            <p className="path">{info.dir}</p>
            <div className="row wrap">
              <button type="button" className="btn outline" onClick={() => library.reveal()}><Icon name="folder" />Open this folder</button>
              <button type="button" className="btn outline" onClick={() => setFolder(null)}>Choose a different folder…</button>
            </div>
            <p className="muted">Changing folder copies your songs and setlists into the new one. Nothing there is overwritten: if it already holds a different song of the same name, both are kept and you are told which.</p>

            <h3>Sync with a cloud drive</h3>
            {info.clouds.length ? (
              <>
                <p>Keeping the library inside a synced folder makes the same songs appear on every PC signed in to that account.</p>
                <div className="row wrap">
                  {info.clouds.map((cloud) => (
                    <button key={cloud.path} type="button" className="btn outline" onClick={() => setFolder(cloud.path)}>Keep library in {cloud.name}</button>
                  ))}
                </div>
              </>
            ) : <p>No OneDrive, Google Drive, Dropbox or iCloud folder was found on this PC. To use another location, choose a different folder above.</p>}
            <div className="note">
              <Icon name="alert" />
              <p><strong>If two PCs change the same song.</strong> On this PC, ChartShift never replaces a version it has not seen: it asks first, and anything it replaces is kept as a “conflict copy”. It cannot control the sync service itself. If two PCs both save before they have synced, the service decides which copy keeps the name and normally keeps the other as its own “conflicted copy”, which shows up here as a separate song.</p>
            </div>

            <h3>Move the library to another PC</h3>
            <p>Export packs every song and setlist into one zip file. Import adds the songs from such a file; nothing already here is overwritten.</p>
            <div className="row wrap">
              <button type="button" className="btn outline" onClick={exportAll}>Export library…</button>
              <button type="button" className="btn outline" onClick={importAll}>Import library…</button>
            </div>
          </TabPanel>
        )}
        <p className="modal-status" role="status" aria-live="polite">{message}</p>
      </div>
    </Modal>
  );
}

// Shown when saving would replace a version of the song this editor has not seen.
export function ConflictDialog({ conflict, onChoose, onClose }) {
  const changed = conflict.reason === 'changed';
  const when = new Date(conflict.modified).toLocaleString();
  return (
    <Modal title={changed ? 'This song was changed somewhere else' : 'That name is already used'} onClose={onClose}
      footer={<button type="button" className="btn outline" onClick={onClose}>Cancel, do not save yet</button>}>
      <div className="modal-body">
        {changed ? (
          <p>“{conflict.name}” was saved from somewhere else, most likely another PC sharing this library, on {when}. That was after you opened it here, so saving over it would lose those changes.</p>
        ) : (
          <p>The library already has a different song called “{conflict.name}” (last saved {when}).</p>
        )}
        <div className="choice-list">
          <button type="button" className="choice recommended" onClick={() => onChoose('copy')}>
            <strong>Save mine as a separate copy</strong>
            <span>{changed ? 'The other version keeps the song’s name. Both stay in the library.' : 'The existing song is not touched. Both stay in the library.'}</span>
          </button>
          <button type="button" className="choice" onClick={() => onChoose('replace')}>
            {changed ? (
              <>
                <strong>Save mine under this name</strong>
                <span>The other version is kept in the library as “{conflict.name} (conflict copy …)”.</span>
              </>
            ) : (
              <>
                <strong>Replace the existing song</strong>
                <span>The existing song leaves the library and goes to the Recycle Bin. It can be restored from there until the bin is emptied.</span>
              </>
            )}
          </button>
        </div>
        <p className="note">
          <Icon name={changed ? 'check' : 'alert'} />
          <span>{changed
            ? 'Either way both versions stay in the library, so nothing is lost. Open them later to compare, and delete the one you do not want.'
            : 'Saving a separate copy keeps both songs in the library. Replacing keeps only yours in the library; the old song is recoverable only from the Recycle Bin.'}</span>
        </p>
      </div>
    </Modal>
  );
}

const inches = (points) => Math.round((points / 72) * 100) / 100;

// Shown before printing pages that differ in size or orientation.
export function PrintSizeDialog({ pages, onPrint, onClose }) {
  const sizes = pageSizes(pages);
  const [mode, setMode] = useState('paper');
  const [paper, setPaper] = useState(() => nearestPaper(pages).id);
  const group = useId();
  const submit = (e) => {
    e.preventDefault();
    onPrint(mode === 'paper' ? { mode, paper: PAPERS.find((p) => p.id === paper) } : { mode: 'own' });
  };
  return (
    <Modal title="These pages are different sizes" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <ul className="sizes">
            {sizes.map((s) => (
              <li key={`${s.w}x${s.h}`}>{plural(s.count, 'page')}: {inches(s.w)} × {inches(s.h)} in ({s.w > s.h ? 'landscape' : 'portrait'})</li>
            ))}
          </ul>
          <fieldset>
            <legend>How should they print?</legend>
            <label className="check">
              <input type="radio" name={group} checked={mode === 'paper'} onChange={() => setMode('paper')} />
              <span><strong>Fit every page onto one paper size</strong><br /><span className="muted">Works with any printer. Each page is scaled to fit and centred; landscape pages are turned sideways on the sheet.</span></span>
            </label>
            <label className="field indent">Paper
              <select value={paper} onChange={(e) => setPaper(e.target.value)} disabled={mode !== 'paper'}>
                {PAPERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            <label className="check">
              <input type="radio" name={group} checked={mode === 'own'} onChange={() => setMode('own')} />
              <span><strong>Print each page at its own size</strong><br /><span className="muted">Needs a printer, or a PDF printer, that can switch paper size within one job.</span></span>
            </label>
          </fieldset>
        </div>
        <footer className="modal-foot">
          <button type="button" className="btn outline" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary"><Icon name="print" />Print</button>
        </footer>
      </form>
    </Modal>
  );
}
