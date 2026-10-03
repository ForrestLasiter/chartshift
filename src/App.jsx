import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createEditor, useEditorState, LEVELS } from './editor/store.js';
import { PageView } from './PageView.jsx';
import { Inspector } from './Inspector.jsx';
import { Icon, Logo } from './icons.jsx';
import { IconButton, Menu, Segmented } from './ui.jsx';
import { ChordReviewDialog, ConflictDialog, LibraryDialog, NameDialog, PrintSizeDialog } from './dialogs.jsx';
import { importPdf, importImage } from './lib/importer.js';
import { loadProject, saveProject } from './lib/project.js';
import { exportPdf, exportSetlistPdf, printImages } from './lib/exporter.js';
import { exportChordPro, layoutChordPro, parseChordPro } from './lib/chordpro.js';
import { renderPageCanvas } from './lib/render.js';
import { FONTS } from './lib/text.js';
import { createRecoveryQueue } from './lib/recoveryQueue.js';
import { isMixed, planPrint } from './lib/printPlan.js';
import { LIMITS } from './lib/songSchema.js';
import * as platform from './lib/platform.js';

const ZOOM_STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3];
const AUTOSAVE_MS = 15000;
const OCR_DPI = 300;
const LEVEL_HELP = {
  section: 'Whole sections (Verse, Chorus…)',
  block: 'A chord line with its lyric line, a staff, a tab system',
  line: 'One line at a time',
  word: 'One word or chord at a time',
  letter: 'Single letters and marks',
};
const TOOLS = [
  { id: 'select', label: 'Move', icon: 'move', help: 'Move: click or drag a box to select, then drag to move (V)' },
  { id: 'text', label: 'Text box', icon: 'text', help: 'Text box: click the page to type new text (T)' },
  { id: 'erase', label: 'Eraser', icon: 'eraser', help: 'Eraser: click or drag across letters to remove them (E)' },
];
const CHORDPRO_EXT = new Set(['cho', 'chopro', 'crd', 'pro']);

const baseName = (name) => name.replace(/\.[^.]+$/, '');
const extension = (name) => (name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function App() {
  const editor = useMemo(createEditor, []);
  // Exposed for development and for the test harness (/?debug).
  if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) window.__editor = editor;
  const state = useEditorState(editor);
  const workspace = useRef(null);
  // 'library' | 'review' | 'saveName', or { type: 'conflict' | 'print', ... }
  const [dialog, setDialog] = useState(null);
  const dialogType = typeof dialog === 'string' ? dialog : dialog?.type;
  // Autosaves and clears go through one queue so a slow autosave can never
  // bring back a recovery copy that a save has just cleared.
  const recovery = useMemo(() => createRecoveryQueue(platform.recovery), []);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [inspectorTab, setInspectorTab] = useState('sections');
  const [recent, setRecent] = useState([]);
  const { pages, selection, zoom, busy } = state;
  const hasDoc = !!pages;

  const fitZoom = useCallback((page) => {
    const width = (workspace.current?.clientWidth || 1000) - 84;
    return Math.max(0.5, Math.min(2, Math.round((width / page.w) * 100) / 100));
  }, []);

  const run = useCallback(async (message, task) => {
    editor.set({ busy: message });
    try {
      await task((text) => editor.set({ busy: text }));
    } catch (error) {
      console.error(error);
      editor.set({ status: error.message || 'Something went wrong.' });
    } finally {
      editor.set({ busy: '' });
    }
  }, [editor]);

  const showDoc = useCallback((doc, { keepRecovery = false } = {}) => {
    editor.setDoc(doc);
    // Whatever was parked for the previous song no longer applies.
    if (!keepRecovery) recovery.clear().catch(() => {});
    // Measure after the sidebar has appeared, so the page fits the space that is left.
    setTimeout(() => editor.set({ zoom: fitZoom(doc.pages[0]) }), 0);
  }, [editor, fitZoom, recovery]);

  // `saved` = { name, version } when the file came from the library.
  const openInto = useCallback(async (file, saved, progress) => {
    const ext = extension(file.name);
    const name = baseName(file.name);
    if (file.data.byteLength > LIMITS.fileBytes) throw new Error('It is too large.');
    if (ext === 'chartshift') {
      const doc = await loadProject(file.data);
      showDoc({ ...doc, name, savedAs: saved?.name ?? null, baseVersion: saved?.version ?? null, status: `Opened ${name}: ${plural(doc.pages.length, 'page')}.` });
      return;
    }
    const ids = { piece: 1, group: 1, page: 1 };
    if (CHORDPRO_EXT.has(ext)) {
      if (file.data.byteLength > LIMITS.chordProBytes) throw new Error('It is too large to be a ChordPro text file.');
      const song = parseChordPro(new TextDecoder().decode(file.data));
      const laidOut = layoutChordPro(song, ids);
      showDoc({ pages: laidOut, atlases: [], ids, name: song.title || name, status: `Opened ChordPro song ${song.title || name}: ${plural(laidOut.length, 'page')}. Every line is an editable text box.` });
      return;
    }
    const atlases = [];
    const { pages: imported, notes } = await (ext === 'pdf' ? importPdf : importImage)(file.data, ids, atlases, progress);
    const count = imported.reduce((n, p) => n + p.pieces.length, 0);
    const extras = [
      notes.straightened && `straightened ${plural(notes.straightened, 'page')}`,
      notes.whitened && `whitened the paper on ${plural(notes.whitened, 'page')}`,
      notes.chords && `found ${plural(notes.chords, 'chord')}`,
    ].filter(Boolean);
    const hint = notes.scans ? ' This is a scan: use “Read text from scan” before transposing.' : '';
    showDoc({
      pages: imported, atlases, ids, name,
      status: `Opened ${file.name}: ${plural(imported.length, 'page')}, ${count} movable pieces${extras.length ? `; ${extras.join(', ')}` : ''}.${hint}`,
    });
  }, [showDoc]);

  // A file that cannot be opened leaves the current song untouched and says why.
  const loadFile = useCallback((file, saved = null) => run('Opening…', async (progress) => {
    try {
      await openInto(file, saved, progress);
    } catch (error) {
      console.error(error);
      throw new Error(`Could not open ${file.name}. ${error.message}`);
    }
  }), [run, openInto]);

  const confirmDiscard = useCallback(
    () => !editor.getState().dirty || window.confirm('This song has changes that are not saved. Open something else anyway?'),
    [editor],
  );

  const open = useCallback(async () => {
    if (!confirmDiscard()) return;
    const file = await platform.openFile();
    if (file) await loadFile(file);
  }, [loadFile, confirmDiscard]);

  const openSample = useCallback(async () => {
    if (!confirmDiscard()) return;
    const response = await fetch('./sample.pdf');
    await loadFile({ name: 'Sample chart.pdf', data: new Uint8Array(await response.arrayBuffer()) });
  }, [loadFile, confirmDiscard]);

  const openFromLibrary = useCallback(async (name) => {
    if (!confirmDiscard()) return;
    setDialog(null);
    let file;
    try {
      file = await platform.library.read(name);
    } catch (error) {
      return editor.set({ status: `Could not open “${name}”. ${error.message}` });
    }
    await loadFile({ name: `${name}.chartshift`, data: file.data }, { name, version: file.version });
  }, [editor, loadFile, confirmDiscard]);

  // Saves to the library. `expect` is the version this editor last read or
  // wrote under that name; if the library's copy is now different (changed on
  // another PC, or a different song with the same name) nothing is written and
  // the user is asked what to do. See the README, "When two PCs change a song".
  const writeSong = useCallback((name, { expect = null, onConflict = 'ask' } = {}) => run('Saving song…', async () => {
    const st = editor.getState();
    const data = await saveProject({ pages: st.pages, atlases: editor.atlases, ids: editor.ids });
    const result = await platform.library.write(name, data, { expect, onConflict });
    if (result.conflict) return setDialog({ type: 'conflict', conflict: result.conflict, expect });
    recovery.clear().catch(() => {});
    const note = result.kept?.length
      ? ` ${result.kept.length === 1 ? 'The other version was' : `${result.kept.length} other versions were`} kept as ${result.kept.map((k) => `“${k}”`).join(', ')}.`
      : result.savedAsCopy ? ' The other version was left as it was.' : '';
    editor.set({ savedAs: result.name, name: result.name, baseVersion: result.version, dirty: false, status: `Saved “${result.name}” to the library.${note}` });
  }), [editor, run, recovery]);

  const saveSong = useCallback((saveAs = false) => {
    const st = editor.getState();
    if (!st.pages) return;
    if (st.savedAs && !saveAs) writeSong(st.savedAs, { expect: st.baseVersion });
    else setDialog('saveName');
  }, [editor, writeSong]);

  const savePdf = useCallback(() => run('Making PDF…', async (progress) => {
    const st = editor.getState();
    const data = await exportPdf(st.pages, editor.atlases, progress);
    const saved = await platform.saveFile({ kind: 'pdf', suggestedName: `${st.name || 'Untitled'}.pdf`, data });
    if (saved) editor.set({ status: `Saved PDF ${saved.name}.` });
  }), [editor, run]);

  // docs = [{ pages, atlases }]. `choice` says which sheet each page goes on.
  const printDocs = useCallback((docs, choice, label) => run('Preparing to print…', async (progress) => {
    const plan = planPrint(docs.flatMap((d) => d.pages), choice);
    const images = [];
    let offset = 0;
    for (const doc of docs) {
      images.push(...(await printImages(doc.pages, doc.atlases, progress, plan.slice(offset, offset + doc.pages.length))));
      offset += doc.pages.length;
    }
    editor.set({ busy: 'Waiting for the print dialog…' });
    const outcome = await platform.printPages(images);
    editor.set({ status: outcome?.success ? `${label} sent to printer.` : 'Printing was cancelled.' });
  }), [editor, run]);

  // Pages of different sizes or orientations need a decision first.
  const requestPrint = useCallback((docs, label) => {
    if (isMixed(docs.flatMap((d) => d.pages))) setDialog({ type: 'print', docs, label });
    else printDocs(docs, { mode: 'own' }, label);
  }, [printDocs]);

  const print = useCallback(() => {
    const st = editor.getState();
    if (st.pages) requestPrint([{ pages: st.pages, atlases: editor.atlases }], 'Song');
  }, [editor, requestPrint]);

  const saveChordPro = useCallback(async () => {
    const st = editor.getState();
    const text = exportChordPro(st.pages, st.name || 'Untitled');
    if (!text) return editor.set({ status: 'There is no readable text to export yet. For a scan, use “Read text from scan” first.' });
    const saved = await platform.saveFile({ kind: 'cho', suggestedName: `${st.name || 'Untitled'}.cho`, data: new TextEncoder().encode(text) });
    if (saved) editor.set({ status: `Exported ChordPro file ${saved.name}.` });
  }, [editor]);

  // OCR every page that still has unread pieces, then let the user check the chords.
  const readText = useCallback(() => run('Reading text…', async (progress) => {
    const { recognise } = await import('./lib/ocr.js');
    const st = editor.getState();
    const rows = [];
    for (let i = 0; i < st.pages.length; i++) {
      const page = st.pages[i];
      const clips = page.pieces.filter((p) => p.kind === 'clip');
      if (!clips.length || clips.filter((p) => p.t).length >= clips.length / 2) { rows.push(null); continue; }
      progress(`Reading text on page ${i + 1} of ${st.pages.length}… (the first time takes a little longer)`);
      rows.push(await recognise(renderPageCanvas(page, editor.atlases, OCR_DPI), OCR_DPI / 72));
    }
    const found = editor.applyRecognisedText(rows);
    setInspectorTab('chords');
    if (found.chords) setDialog('review');
  }), [editor, run]);

  const loadSetlist = useCallback(async (setlist, progress) => {
    const songs = [];
    for (const name of setlist.songs) {
      if (!(await platform.library.exists(name))) continue;
      progress(`Loading ${name}…`);
      try {
        songs.push({ name, ...(await loadProject((await platform.library.read(name)).data)) });
      } catch (error) {
        throw new Error(`“${name}” could not be read. ${error.message}`);
      }
    }
    return songs;
  }, []);

  const setlistPdf = useCallback((setlist) => run('Building setlist…', async (progress) => {
    const data = await exportSetlistPdf(await loadSetlist(setlist, progress), progress);
    const saved = await platform.saveFile({ kind: 'pdf', suggestedName: `${setlist.name}.pdf`, data });
    if (saved) editor.set({ status: `Saved setlist PDF ${saved.name}.` });
  }), [editor, run, loadSetlist]);

  const setlistPrint = useCallback(async (setlist) => {
    let songs = null;
    await run('Building setlist…', async (progress) => { songs = await loadSetlist(setlist, progress); });
    if (songs?.length) requestPrint(songs, `Setlist “${setlist.name}”`);
  }, [run, loadSetlist, requestPrint]);

  const stepZoom = useCallback((direction) => {
    const current = editor.getState().zoom;
    const next = direction > 0
      ? ZOOM_STEPS.find((z) => z > current + 0.001) ?? current
      : [...ZOOM_STEPS].reverse().find((z) => z < current - 0.001) ?? current;
    editor.set({ zoom: next });
  }, [editor]);

  useEffect(() => { platform.setDirty(state.dirty); }, [state.dirty]);

  // The welcome screen lists the most recently saved songs.
  useEffect(() => {
    if (hasDoc) return;
    platform.library.list()
      .then(({ songs }) => setRecent(songs.slice().sort((a, b) => b.modified - a.modified).slice(0, 5)))
      .catch(() => setRecent([]));
  }, [hasDoc, dialog]);
  useEffect(() => {
    platform.setTitle(`${state.name ? `${state.name}${state.dirty ? ' •' : ''} – ` : ''}ChartShift`);
  }, [state.name, state.dirty]);

  // Autosave: park unsaved work where it can be recovered after a crash or power cut.
  useEffect(() => {
    if (!state.dirty || !state.pages) return undefined;
    const timer = setTimeout(() => {
      recovery.save(async () => {
        const st = editor.getState();
        const data = await saveProject({ pages: st.pages, atlases: editor.atlases, ids: editor.ids });
        return { meta: { name: st.name, savedAs: st.savedAs, baseVersion: st.baseVersion }, data };
      }).catch((error) => console.error('autosave failed', error));
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [editor, recovery, state.pages, state.dirty]);

  // On start: offer back any work that was never saved; /?sample opens the sample (development).
  useEffect(() => {
    (async () => {
      const params = new URLSearchParams(location.search);
      if (params.has('sample')) {
        await openSample();
        // /?sample&ocr (smoke test): forget the sample's text and read it back with OCR.
        if (params.has('ocr')) {
          const st = editor.getState();
          const pages = st.pages.slice(0, 1).map((pg) => ({ ...pg, pieces: pg.pieces.map(({ t, tok, chord, ff, bold, ...p }) => p) }));
          editor.setDoc({ pages, atlases: editor.atlases, ids: editor.ids, name: 'OCR check', status: 'Reading…' });
          await readText();
        }
        return;
      }
      const parked = await platform.recovery.load();
      if (!parked) return;
      if (window.confirm(`ChartShift closed with unsaved changes to “${parked.meta.name || 'Untitled'}”. Bring them back?`)) {
        try {
          const doc = await loadProject(parked.data);
          showDoc({ ...doc, name: parked.meta.name, savedAs: parked.meta.savedAs, baseVersion: parked.meta.baseVersion, status: 'Unsaved work restored. Save it to keep it.' }, { keepRecovery: true });
          editor.set({ dirty: true });
        } catch (error) {
          editor.set({ status: `The unsaved work could not be restored. ${error.message}` });
          await recovery.clear();
        }
      } else {
        await recovery.clear();
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.closest?.('dialog')) return;
      const st = editor.getState();
      if (st.busy) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const done = () => e.preventDefault();
      if (mod && key === 'o') { done(); open(); return; }
      if (mod && key === 'l') { done(); setDialog('library'); return; }
      if (!st.pages) return;
      if (mod) {
        if (key === 's') { done(); saveSong(e.shiftKey); }
        else if (key === 'e') { done(); savePdf(); }
        else if (key === 'p') { done(); print(); }
        else if (key === 'z') { done(); if (e.shiftKey) editor.redo(); else editor.undo(); }
        else if (key === 'y') { done(); editor.redo(); }
        else if (key === 'c') { done(); editor.copy(); }
        else if (key === 'x') { done(); editor.cut(); }
        else if (key === 'v') { done(); editor.paste(); }
        else if (key === 'd') { done(); editor.duplicateSelection(); }
        else if (key === 'a') { done(); editor.selectAll(); }
        else if (key === '=' || key === '+') { done(); stepZoom(1); }
        else if (key === '-') { done(); stepZoom(-1); }
        return;
      }
      // Leave Space/Enter alone so focused buttons keep working.
      if (key === 'delete' || (key === 'backspace' && tag !== 'BUTTON')) { done(); editor.deleteSelection(); }
      else if (key === 'escape') { editor.select([]); }
      else if (key.startsWith('arrow') && st.selection.size) {
        done();
        const step = e.shiftKey ? 10 : 1;
        const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0;
        const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0;
        editor.moveSelection(dx, dy);
      }
      else if (key === '.') editor.selectStep(1);
      else if (key === ',') editor.selectStep(-1);
      else if (key === 'v') editor.set({ tool: 'select' });
      else if (key === 't') editor.set({ tool: 'text' });
      else if (key === 'e') editor.set({ tool: 'erase' });
      else if (key >= '1' && key <= '5') editor.set({ level: LEVELS[Number(key) - 1] });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor, open, saveSong, savePdf, print, stepZoom]);

  const selectedText = hasDoc && pages.some((page) => page.pieces.some((p) => p.kind === 'text' && selection.has(p.id)));
  const showText = hasDoc && (state.tool === 'text' || state.editing || selectedText);
  const style = state.textStyle;
  const none = !selection.size;

  const docState = !hasDoc ? '' : state.dirty ? 'Unsaved changes' : state.savedAs ? 'Saved in library' : 'Not saved to the library yet';

  return (
    <div className="app">
      <a className="skip-link" href="#workspace">Skip to the page</a>

      <header className="titlebar">
        <div className="brand"><Logo /><span>ChartShift</span></div>
        <div className="doc">
          {hasDoc && (
            <>
              <h1 className="doc-name" title={state.name}>{state.name || 'Untitled song'}</h1>
              <span className="doc-state">{state.dirty && <span className="dot" aria-hidden="true" />}{docState}</span>
            </>
          )}
        </div>
        <div className="file-actions" role="toolbar" aria-label="File">
          <button type="button" className="btn" onClick={open} title="Open a PDF, image, ChordPro file or song (Ctrl+O)"><Icon name="folder" />Open</button>
          <button type="button" className="btn" onClick={() => setDialog('library')} title="Saved songs and setlists (Ctrl+L)"><Icon name="library" />Library</button>
          <button type="button" className="btn primary" onClick={() => saveSong(false)} disabled={!hasDoc} title="Save to the library (Ctrl+S)"><Icon name="save" />Save</button>
          <button type="button" className="btn" onClick={savePdf} disabled={!hasDoc} title="Save as a PDF (Ctrl+E)" aria-label="Save as PDF"><Icon name="pdf" /><span className="optional">PDF</span></button>
          <button type="button" className="btn" onClick={print} disabled={!hasDoc} title="Print (Ctrl+P)" aria-label="Print"><Icon name="print" /><span className="optional">Print</span></button>
          <Menu label="More file actions" items={[
            { label: 'Save under a new name…', icon: 'save', shortcut: 'Ctrl+Shift+S', disabled: !hasDoc, onSelect: () => saveSong(true) },
            { label: 'Export as ChordPro (.cho)', icon: 'music', disabled: !hasDoc, onSelect: saveChordPro },
            { label: 'Open the sample chart', icon: 'page', onSelect: openSample },
          ]} />
        </div>
      </header>

      {hasDoc && (
        <div className="toolbar" role="toolbar" aria-label="Editing">
          <div className="cluster">
            <IconButton icon="undo" label="Undo" hint="Undo (Ctrl+Z)" onClick={editor.undo} disabled={!state.canUndo} />
            <IconButton icon="redo" label="Redo" hint="Redo (Ctrl+Y)" onClick={editor.redo} disabled={!state.canRedo} />
          </div>
          <span className="divider" aria-hidden="true" />
          <Segmented label="Tool" options={TOOLS} value={state.tool} onChange={(tool) => editor.set({ tool })} />
          <Segmented label="Select by" value={state.level} onChange={(level) => editor.set({ level })}
            options={LEVELS.map((id, i) => ({ id, label: id[0].toUpperCase() + id.slice(1), help: `${LEVEL_HELP[id]} (${i + 1})` }))} />
          <span className="divider" aria-hidden="true" />
          <div className="cluster">
            <IconButton icon="copy" label="Copy" hint="Copy (Ctrl+C)" onClick={editor.copy} disabled={none} />
            <IconButton icon="paste" label="Paste" hint="Paste onto the current page (Ctrl+V)" onClick={editor.paste} />
            <IconButton icon="duplicate" label="Duplicate" hint="Duplicate (Ctrl+D)" onClick={editor.duplicateSelection} disabled={none} />
            <IconButton icon="trash" label="Delete" hint="Delete (Del)" onClick={editor.deleteSelection} disabled={none} />
          </div>
          <span className="spacer" />
          <div className="cluster">
            <IconButton icon="zoomOut" label="Zoom out" hint="Zoom out (Ctrl+-)" onClick={() => stepZoom(-1)} />
            <span className="zoom-value" aria-label={`Zoom ${Math.round(zoom * 100)} percent`}>{Math.round(zoom * 100)}%</span>
            <IconButton icon="zoomIn" label="Zoom in" hint="Zoom in (Ctrl++)" onClick={() => stepZoom(1)} />
            <IconButton icon="fit" label="Fit" hint="Fit the page to the window width" onClick={() => editor.set({ zoom: fitZoom(pages[0]) })} />
          </div>
          <span className="divider" aria-hidden="true" />
          <IconButton icon="panel" label="Song tools panel" hint={inspectorOpen ? 'Hide the song tools panel' : 'Show the song tools panel'}
            aria-pressed={inspectorOpen} onClick={() => setInspectorOpen(!inspectorOpen)} />
        </div>
      )}

      {showText && (
        <div className="toolbar text-bar" role="toolbar" aria-label="Text box style">
          <span className="bar-title">Text</span>
          <label>Font
            <select value={style.font} onChange={(e) => editor.setTextStyle({ font: e.target.value })}>
              {FONTS.map((f) => <option key={f.css} value={f.css}>{f.label}</option>)}
            </select>
          </label>
          <label>Size
            <input type="number" min="4" max="144" step="1" value={style.size}
              onChange={(e) => { const size = Number(e.target.value); if (size >= 4 && size <= 144) editor.setTextStyle({ size }); }} />
          </label>
          <button type="button" className="btn" aria-pressed={style.bold} onClick={() => editor.setTextStyle({ bold: !style.bold })}><b>Bold</b></button>
          <button type="button" className="btn" aria-pressed={style.italic} onClick={() => editor.setTextStyle({ italic: !style.italic })}><i>Italic</i></button>
          <label>Colour
            <input type="color" value={style.color} onChange={(e) => editor.setTextStyle({ color: e.target.value })} />
          </label>
        </div>
      )}

      <div className="body">
        <main className="workspace" id="workspace" tabIndex={-1} ref={workspace} aria-busy={!!busy}>
          {hasDoc ? (
            pages.map((page, index) => (
              <PageView key={page.id} editor={editor} state={state} page={page} index={index} pageCount={pages.length} />
            ))
          ) : (
            <div className="welcome">
              <div className="welcome-head"><Logo size={40} /><h1>ChartShift</h1></div>
              <p className="lead">Open a chord chart, tab or sheet music PDF. Every line, word and letter becomes a piece you can move, erase or copy. Add text, change the key, then save it as a PDF or print it.</p>
              <div className="welcome-actions">
                <button type="button" className="btn primary large" onClick={open}><Icon name="folder" />Open a PDF or image…</button>
                <button type="button" className="btn outline large" onClick={() => setDialog('library')}><Icon name="library" />Song library</button>
              </div>
              <h2>Recent songs</h2>
              {recent.length ? (
                <ul className="recent">
                  {recent.map((song) => (
                    <li key={song.name}>
                      <button type="button" onClick={() => openFromLibrary(song.name)} aria-label={`Open ${song.name}`}>
                        <Icon name="music" />
                        <span className="name">{song.name}</span>
                        <span className="when">{new Date(song.modified).toLocaleDateString()}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : <p className="empty">Songs you save to the library will appear here.</p>}
              <p className="welcome-foot">New here?<button type="button" className="btn link" onClick={openSample}>Try the sample chart</button></p>
            </div>
          )}
        </main>
        {hasDoc && inspectorOpen && (
          <Inspector editor={editor} state={state} tab={inspectorTab} onTab={setInspectorTab}
            onReadText={readText} onReview={() => setDialog('review')} onPdf={savePdf} onPrint={print} onChordPro={saveChordPro} />
        )}
      </div>

      <footer className="statusbar">
        <span role="status" aria-live="polite">{busy && <span className="spinner" aria-hidden="true" />}{busy || state.status}</span>
        {hasDoc && <span className="hint">Shift-drag: straight line · Alt-drag: no snapping · Arrows: nudge · . and , step through pieces</span>}
      </footer>

      {dialogType === 'library' && (
        <LibraryDialog onClose={() => setDialog(null)} onOpenSong={openFromLibrary}
          onRenamed={(from, to) => { if (editor.getState().savedAs === from) editor.set({ savedAs: to, name: to }); }}
          onSetlistPdf={(s) => { setDialog(null); setlistPdf(s); }}
          onSetlistPrint={(s) => { setDialog(null); setlistPrint(s); }}
          notify={(status) => editor.set({ status })} />
      )}
      {dialogType === 'review' && <ChordReviewDialog editor={editor} onClose={() => setDialog(null)} />}
      {dialogType === 'saveName' && (
        <NameDialog title="Save song" label="Song name" initial={state.name || 'Untitled'} action="Save to library"
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            setDialog(null);
            await writeSong(name, { expect: name === state.savedAs ? state.baseVersion : null });
          }} />
      )}
      {dialogType === 'conflict' && (
        <ConflictDialog conflict={dialog.conflict} onClose={() => setDialog(null)}
          onChoose={(onConflict) => { setDialog(null); writeSong(dialog.conflict.name, { expect: dialog.expect, onConflict }); }} />
      )}
      {dialogType === 'print' && (
        <PrintSizeDialog pages={dialog.docs.flatMap((d) => d.pages)} onClose={() => setDialog(null)}
          onPrint={(choice) => { setDialog(null); printDocs(dialog.docs, choice, dialog.label); }} />
      )}

      {busy && (
        <div className="busy" aria-hidden="true">
          <div className="busy-card"><span>{busy}</span><div className="progress" /></div>
        </div>
      )}
    </div>
  );
}
