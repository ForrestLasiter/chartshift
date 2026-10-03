import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { boundsOf } from './lib/render.js';
import { isChord } from './lib/chords.js';
import { library } from './lib/platform.js';

// A native modal <dialog>: the browser traps Tab inside it, closes it on
// Escape, and returns focus to whatever opened it.
export function Modal({ title, onClose, children, wide }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog.open) dialog.showModal();
    // Start on the first control of the content rather than the Close button.
    dialog.querySelector('.modal-body :is(input, select, button, [tabindex="0"])')?.focus();
    return () => dialog.close();
  }, []);
  return (
    <dialog ref={ref} className={`modal${wide ? ' wide' : ''}`} aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <header className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <button type="button" onClick={onClose} aria-label={`Close ${title}`}>Close</button>
      </header>
      <div className="modal-body">{children}</div>
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
      <form onSubmit={submit} className="stack">
        <label htmlFor={id}>{label}</label>
        <input id={id} type="text" value={name} autoFocus maxLength={120}
          onChange={(e) => { setName(e.target.value); setError(''); }} aria-describedby={error ? `${id}-error` : undefined} />
        {error && <p id={`${id}-error`} className="error" role="alert">{error}</p>}
        <div className="row end">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary">{action}</button>
        </div>
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
    <Modal title="Check the chords" onClose={onClose} wide>
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
          {invalid.length > 0 && <p className="error" role="alert">{invalid.length} box{invalid.length === 1 ? ' is' : 'es are'} not a chord name (marked in red). Fix or clear {invalid.length === 1 ? 'it' : 'them'}.</p>}
          <div className="row end">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="button" className="primary" onClick={apply} disabled={invalid.length > 0}>Save chords</button>
          </div>
        </>
      ) : (
        <p>No chords have been found yet. For a scanned page, use “Read text from scan” first. You can also select a chord on the page and use “Mark as chord”.</p>
      )}
    </Modal>
  );
}

const TABS = [['songs', 'Songs'], ['setlists', 'Setlists'], ['folder', 'Folder and sync']];

export function LibraryDialog({ onClose, onOpenSong, onSetlistPdf, onSetlistPrint, notify }) {
  const [tab, setTab] = useState('songs');
  const [data, setData] = useState({ songs: [], setlists: [] });
  const [info, setInfo] = useState({ dir: '', clouds: [] });
  const [search, setSearch] = useState('');
  const [current, setCurrent] = useState('');
  const [newSetlist, setNewSetlist] = useState('');
  const [renaming, setRenaming] = useState(null);
  const [message, setMessage] = useState('');
  const tabRefs = useRef({});

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
    if (to && to !== from) { await library.rename(from, to); say(`Renamed to “${to}”.`); }
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
    if (result) say(`Exported ${result.count} files to ${result.path}.`);
  });
  const importAll = guard(async () => {
    const result = await library.importAll();
    if (result) say(`Imported ${result.added} new file${result.added === 1 ? '' : 's'}${result.skipped ? `; ${result.skipped} already here were left as they are` : ''}.`);
  });
  const setFolder = guard(async (cloudPath) => {
    const result = await library.setFolder(cloudPath);
    if (result) say(`Library folder is now ${result.dir}.${result.copied ? ` ${result.copied} files were copied across; the originals are still in ${result.previous}.` : ''}`);
  });

  const onTabKey = (e) => {
    const order = TABS.map(([id]) => id);
    let i = order.indexOf(tab);
    if (e.key === 'ArrowRight') i = (i + 1) % order.length;
    else if (e.key === 'ArrowLeft') i = (i + order.length - 1) % order.length;
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = order.length - 1;
    else return;
    e.preventDefault();
    setTab(order[i]);
    tabRefs.current[order[i]]?.focus();
  };

  return (
    <Modal title="Song library" onClose={onClose} wide>
      <div role="tablist" aria-label="Library" className="tabs" onKeyDown={onTabKey}>
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`panel-${id}`}
            tabIndex={tab === id ? 0 : -1} ref={(el) => { tabRefs.current[id] = el; }} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'songs' && (
        <div role="tabpanel" id="panel-songs" aria-labelledby="tab-songs" className="stack">
          <label className="row">Search
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          {songs.length ? (
            <ul className="list">
              {songs.map((song) => (
                <li key={song.name}>
                  {renaming === song.name ? (
                    <form className="row grow" onSubmit={(e) => { e.preventDefault(); rename(song.name, e.target.elements.name.value.trim()); }}>
                      <input name="name" type="text" defaultValue={song.name} autoFocus aria-label={`New name for ${song.name}`} maxLength={120} />
                      <button type="submit">Save name</button>
                      <button type="button" onClick={() => setRenaming(null)}>Cancel</button>
                    </form>
                  ) : (
                    <>
                      <span className="grow"><strong>{song.name}</strong> <small>{new Date(song.modified).toLocaleDateString()}</small></span>
                      <button type="button" className="primary" onClick={() => onOpenSong(song.name)} aria-label={`Open ${song.name}`}>Open</button>
                      {data.setlists.length > 0 && (
                        <select value="" aria-label={`Add ${song.name} to a setlist`}
                          onChange={(e) => { const s = data.setlists.find((x) => x.name === e.target.value); if (s) { saveSetlist(s.name, [...s.songs, song.name]); say(`Added “${song.name}” to ${s.name}.`); } }}>
                          <option value="">Add to setlist…</option>
                          {data.setlists.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
                        </select>
                      )}
                      <button type="button" onClick={() => setRenaming(song.name)} aria-label={`Rename ${song.name}`}>Rename</button>
                      <button type="button" onClick={() => removeSong(song.name)} aria-label={`Delete ${song.name}`}>Delete</button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>{data.songs.length ? 'No songs match that search.' : 'No songs saved yet. Open a PDF, then use “Save song” to add it here.'}</p>
          )}
        </div>
      )}

      {tab === 'setlists' && (
        <div role="tabpanel" id="panel-setlists" aria-labelledby="tab-setlists" className="stack">
          <form className="row" onSubmit={createSetlist}>
            <label className="row grow">New setlist
              <input type="text" value={newSetlist} onChange={(e) => setNewSetlist(e.target.value)} placeholder="e.g. Sunday 12 October" maxLength={120} />
            </label>
            <button type="submit">Create</button>
          </form>
          {setlist ? (
            <>
              <label className="row">Setlist
                <select value={setlist.name} onChange={(e) => setCurrent(e.target.value)}>
                  {data.setlists.map((s) => <option key={s.name} value={s.name}>{s.name} ({s.songs.length})</option>)}
                </select>
              </label>
              {setlist.songs.length ? (
                <ol className="list">
                  {setlist.songs.map((name, i) => (
                    <li key={`${name}-${i}`}>
                      <span className="grow">{i + 1}. {name}{!known.has(name) && <em> (missing from the library)</em>}</span>
                      <button type="button" disabled={i === 0} onClick={() => moveInSetlist(i, -1)} aria-label={`Move ${name} earlier`}>Up</button>
                      <button type="button" disabled={i === setlist.songs.length - 1} onClick={() => moveInSetlist(i, 1)} aria-label={`Move ${name} later`}>Down</button>
                      <button type="button" onClick={() => saveSetlist(setlist.name, setlist.songs.filter((_, j) => j !== i))} aria-label={`Remove ${name} from the setlist`}>Remove</button>
                    </li>
                  ))}
                </ol>
              ) : <p>This setlist is empty. Add songs below.</p>}
              <label className="row">Add a song
                <select value="" onChange={(e) => e.target.value && saveSetlist(setlist.name, [...setlist.songs, e.target.value])}>
                  <option value="">Choose a song…</option>
                  {data.songs.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
                </select>
              </label>
              <div className="row end">
                <button type="button" onClick={() => removeSetlist(setlist.name)}>Delete setlist</button>
                <button type="button" disabled={!setlist.songs.some((n) => known.has(n))} onClick={() => onSetlistPrint(setlist)}>Print setlist</button>
                <button type="button" className="primary" disabled={!setlist.songs.some((n) => known.has(n))} onClick={() => onSetlistPdf(setlist)}>Save setlist as one PDF</button>
              </div>
            </>
          ) : <p>No setlists yet. Create one above, then add songs to it in the order you will play them.</p>}
        </div>
      )}

      {tab === 'folder' && (
        <div role="tabpanel" id="panel-folder" aria-labelledby="tab-folder" className="stack">
          <h3>Where songs are kept</h3>
          <p className="path">{info.dir}</p>
          <div className="row">
            <button type="button" onClick={() => library.reveal()}>Open this folder</button>
            <button type="button" onClick={() => setFolder(null)}>Choose a different folder…</button>
          </div>
          <h3>Sync with a cloud drive</h3>
          {info.clouds.length ? (
            <>
              <p>Keeping the library inside a synced folder makes the same songs appear on every PC signed in to that account.</p>
              <div className="row">
                {info.clouds.map((cloud) => (
                  <button key={cloud.path} type="button" onClick={() => setFolder(cloud.path)}>Keep library in {cloud.name}</button>
                ))}
              </div>
            </>
          ) : <p>No OneDrive, Google Drive, Dropbox or iCloud folder was found on this PC. If you install one, or want another location, use “Choose a different folder”.</p>}
          <h3>Move the library to another PC</h3>
          <p>Export packs every song and setlist into one zip file. Import adds the songs from such a file; songs already here are never overwritten.</p>
          <div className="row">
            <button type="button" onClick={exportAll}>Export library…</button>
            <button type="button" onClick={importAll}>Import library…</button>
          </div>
        </div>
      )}
      <p className="modal-status" role="status" aria-live="polite">{message}</p>
    </Modal>
  );
}
