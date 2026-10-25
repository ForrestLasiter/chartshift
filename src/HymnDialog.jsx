import { useEffect, useId, useMemo, useState } from 'react';
import { library } from './lib/platform.js';
import { findHymns, matchIndex, parseIndex } from './lib/hymnIndex.js';
import { Modal } from './dialogs.jsx';
import { Icon } from './icons.jsx';

let loading = null;
/** The free hymn library that ships with the app (public/hymnal/hymns.json). */
export function hymnLibrary() {
  if (!loading) {
    loading = fetch(new URL('./hymnal/hymns.json', document.baseURI))
      .then((r) => { if (!r.ok) throw new Error('The hymn library could not be loaded.'); return r.json(); })
      .then((data) => data.hymns)
      .catch((error) => { loading = null; throw error; });
  }
  return loading;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Finds a hymn by title, first line or its number in the church's hymnal,
// and keeps the church's hymnals (each one's index, matched to the library).
export function HymnDialog({ onOpen, onClose }) {
  const id = useId();
  const [hymns, setHymns] = useState(null);
  const [error, setError] = useState('');
  const [hymnals, setHymnals] = useState({ books: [], current: null });
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    hymnLibrary().then(setHymns, (e) => setError(e.message));
    library.readHymnals?.().then((h) => { setHymnals(h); if (!h.books.length) setAdding(false); }, () => {});
  }, []);

  const book = hymnals.books.find((b) => b.name === hymnals.current) || null;
  const results = useMemo(() => (hymns ? findHymns(query, hymns, book) : []), [query, hymns, book]);

  const save = async (next) => {
    const saved = library.saveHymnals ? await library.saveHymnals(next) : next;
    setHymnals(saved);
  };
  const choose = (row) => {
    if (row.hymn) return onOpen({ hymn: row.hymn, number: row.number, book: book?.name || '' });
    setNote(`“${row.title}” (No. ${row.number} in ${book.name}) is not in the free library: it is most likely still under copyright. Open a photo or PDF of its page instead, and use Read sheet music on the Chords tab.`);
  };

  if (adding) {
    return (
      <Modal title="Add a hymnal" onClose={onClose} wide>
        <AddHymnal hymns={hymns || []} existing={hymnals.books.map((b) => b.name)}
          onCancel={() => setAdding(false)}
          onSave={async (newBook) => {
            await save({ books: [...hymnals.books.filter((b) => b.name !== newBook.name), newBook], current: newBook.name });
            setAdding(false);
            setNote(`Saved “${newBook.name}”. Type a number from it to find that song.`);
          }} />
      </Modal>
    );
  }

  return (
    <Modal title="Find a hymn" onClose={onClose} wide>
      <div className="modal-body">
        <label className="field" htmlFor={`${id}-q`}>{book ? 'Title, first line, or number in your hymnal' : 'Title or first line'}</label>
        <input id={`${id}-q`} type="search" value={query} autoFocus placeholder={book ? 'e.g. 209, or Amazing Grace' : 'e.g. Amazing Grace'}
          onChange={(e) => { setQuery(e.target.value); setNote(''); }} aria-describedby={`${id}-count`} />
        {error && <p className="error" role="alert">{error}</p>}
        <p id={`${id}-count`} className="muted" role="status">
          {!hymns && !error ? 'Loading the hymn library…'
            : query.trim() ? (results.length ? `${plural(results.length, 'song')} found.` : /^\d+[a-z]?$/i.test(query.trim()) && !book ? 'Add your hymnal to look songs up by number.' : 'No songs found.')
              : `${hymns ? hymns.length : 0} free songs. Type to search.`}
        </p>
        {note && <p className="note" role="status">{note}</p>}
        {results.length > 0 && (
          <ul className="recent hymn-results">
            {results.map((row) => (
              <li key={(row.hymn?.id || 'missing') + row.number + row.title}>
                <button type="button" onClick={() => choose(row)}>
                  {book && <span className="hymn-number">{row.number ? `No. ${row.number}` : ''}</span>}
                  <span className="name">{row.title}
                    <span className="hymn-line">{row.hymn ? row.hymn.firstLine : 'In your hymnal, not in the free library'}</span>
                  </span>
                  <Icon name={row.hymn ? 'music' : 'alert'} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="row bottom">
          <label className="field grow" htmlFor={`${id}-book`}>Your hymnal
            <select id={`${id}-book`} value={hymnals.current || ''} onChange={(e) => save({ ...hymnals, current: e.target.value || null })}>
              {!hymnals.books.length && <option value="">None added yet</option>}
              {hymnals.books.map((b) => <option key={b.name} value={b.name}>{b.name} ({plural(b.entries.length, 'song')})</option>)}
            </select>
          </label>
          <button type="button" className="btn outline" onClick={() => setAdding(true)}><Icon name="plus" />Add a hymnal…</button>
          {book && (
            <button type="button" className="btn outline" onClick={() => { if (window.confirm(`Remove “${book.name}” and its numbers? The songs themselves stay in the library.`)) save({ books: hymnals.books.filter((b) => b !== book), current: null }); }}>
              <Icon name="trash" />Remove
            </button>
          )}
        </div>
        <p className="muted small">Songs from WorshipCommons (public domain and Creative Commons) and the Open Hymnal Project. Songs still under copyright, like many gospel songs of the 1900s, are not included.</p>
      </div>
    </Modal>
  );
}

// Reads a hymnal's index (pictures of its pages, a PDF, or typed text) and
// matches each song to the library.
function AddHymnal({ hymns, existing, onSave, onCancel }) {
  const id = useId();
  const [name, setName] = useState('');
  const [files, setFiles] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState('');

  const read = async () => {
    setError('');
    try {
      let source = text;
      if (files.length) {
        setBusy('Reading the index…');
        const { readIndexFiles } = await import('./lib/indexReader.js');
        source = (await readIndexFiles(files, setBusy)) + '\n' + text;
      }
      const found = parseIndex(source);
      if (!found.length) throw new Error('No songs with numbers were found. Check the pictures are of the index pages, or type the index in the box.');
      setEntries(matchIndex(found, hymns));
      setText(found.map((e) => `${e.number} ${e.title}`).join('\n'));
      setFiles([]);
    } catch (e) {
      setError(e.message || 'The index could not be read.');
    } finally {
      setBusy('');
    }
  };
  const matched = entries ? entries.filter((e) => e.hymn).length : 0;
  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) return setError('Give the hymnal a name first.');
    if (!entries) return read();
    if (existing.includes(name.trim()) && !window.confirm(`Replace the numbers saved for “${name.trim()}”?`)) return;
    onSave({ name: name.trim(), entries });
  };

  return (
    <form onSubmit={submit}>
      <div className="modal-body">
        <p>Give ChartShift your hymnal’s index, and it finds each song’s number for you. Then you can type a number from the hymn board to open the song.</p>
        <label className="field" htmlFor={`${id}-name`}>Hymnal name</label>
        <input id={`${id}-name`} type="text" value={name} maxLength={120} placeholder="e.g. Heavenly Highway Hymns" onChange={(e) => { setName(e.target.value); setError(''); }} />
        <label className="field" htmlFor={`${id}-files`}>Pictures or a PDF of the index pages</label>
        <input id={`${id}-files`} type="file" multiple accept="image/*,.pdf,.txt,.csv" onChange={(e) => { setFiles([...e.target.files]); setEntries(null); }} />
        <label className="field" htmlFor={`${id}-text`}>{entries ? 'The index as read (fix any mistakes, then read it again)' : 'Or type or paste the index, one song a line'}</label>
        <textarea id={`${id}-text`} rows={8} value={text} placeholder={'Amazing Grace .... 209\n14 Blessed Assurance'} onChange={(e) => { setText(e.target.value); setEntries(null); }} />
        {busy && <p role="status"><span className="spinner" aria-hidden="true" />{busy}</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {entries && (
          <div role="status">
            <p><strong>{matched} of {plural(entries.length, 'song')}</strong> found in the free library.{entries.length > matched ? ` The other ${entries.length - matched} are kept too, so their numbers still say what the song is.` : ''}</p>
            {entries.length > matched && (
              <details>
                <summary>Not in the free library</summary>
                <ul>{entries.filter((e) => !e.hymn).slice(0, 200).map((e) => <li key={e.number + e.title}>{e.number} {e.title}</li>)}</ul>
              </details>
            )}
          </div>
        )}
      </div>
      <footer className="modal-foot">
        <button type="button" className="btn outline" onClick={onCancel}>Back</button>
        <button type="button" className="btn outline" onClick={read} disabled={!!busy || (!files.length && !text.trim())}>Read the index</button>
        <button type="submit" className="btn primary" disabled={!!busy || !entries}>Save hymnal</button>
      </footer>
    </form>
  );
}
