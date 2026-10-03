import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createEditor, useEditorState, LEVELS } from './editor/store.js';
import { PageView } from './PageView.jsx';
import { Sidebar } from './Sidebar.jsx';
import { ChordReviewDialog, LibraryDialog, NameDialog } from './dialogs.jsx';
import { importPdf, importImage } from './lib/importer.js';
import { loadProject, saveProject } from './lib/project.js';
import { exportPdf, exportSetlistPdf, printImages } from './lib/exporter.js';
import { exportChordPro, layoutChordPro, parseChordPro } from './lib/chordpro.js';
import { renderPageCanvas } from './lib/render.js';
import { FONTS } from './lib/text.js';
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
  { id: 'select', label: 'Move', help: 'Click or drag a box to select, then drag to move (V)' },
  { id: 'text', label: 'Text box', help: 'Click the page to type new text (T)' },
  { id: 'erase', label: 'Eraser', help: 'Click or drag across letters to remove them (E)' },
];
const CHORDPRO_EXT = new Set(['cho', 'chopro', 'crd', 'pro']);

const baseName = (name) => name.replace(/\.[^.]+$/, '');
const extension = (name) => (name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function Choice({ label, options, value, onChange }) {
  return (
    <div className="group" role="radiogroup" aria-label={label}>
      <span className="group-label" aria-hidden="true">{label}</span>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} title={o.help}
          className={value === o.id ? 'on' : ''} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function App() {
  const editor = useMemo(createEditor, []);
  if (import.meta.env.DEV) window.__editor = editor;
  const state = useEditorState(editor);
  const workspace = useRef(null);
  const [dialog, setDialog] = useState(null); // 'library' | 'review' | 'saveName'
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
      editor.set({ status: `Something went wrong: ${error.message}` });
    } finally {
      editor.set({ busy: '' });
    }
  }, [editor]);

  const showDoc = useCallback((doc) => {
    editor.setDoc(doc);
    // Measure after the sidebar has appeared, so the page fits the space that is left.
    setTimeout(() => editor.set({ zoom: fitZoom(doc.pages[0]) }), 0);
  }, [editor, fitZoom]);

  const loadFile = useCallback((file, savedAs = null) => run('Opening…', async (progress) => {
    const ext = extension(file.name);
    const name = baseName(file.name);
    if (ext === 'chartshift') {
      const doc = await loadProject(file.data);
      showDoc({ ...doc, name, savedAs, status: `Opened ${name}: ${plural(doc.pages.length, 'page')}.` });
      return;
    }
    const ids = { piece: 1, group: 1, page: 1 };
    if (CHORDPRO_EXT.has(ext)) {
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
  }), [run, showDoc]);

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
    await loadFile({ name: `${name}.chartshift`, data: await platform.library.read(name) }, name);
  }, [loadFile, confirmDiscard]);

  const writeSong = useCallback((name) => run('Saving song…', async () => {
    const st = editor.getState();
    const data = await saveProject({ pages: st.pages, atlases: editor.atlases, ids: editor.ids });
    const saved = await platform.library.write(name, data);
    await platform.recovery.clear();
    editor.set({ savedAs: saved, name: saved, dirty: false, status: `Saved “${saved}” to the library.` });
  }), [editor, run]);

  const saveSong = useCallback((saveAs = false) => {
    const st = editor.getState();
    if (!st.pages) return;
    if (st.savedAs && !saveAs) writeSong(st.savedAs);
    else setDialog('saveName');
  }, [editor, writeSong]);

  const savePdf = useCallback(() => run('Making PDF…', async (progress) => {
    const st = editor.getState();
    const data = await exportPdf(st.pages, editor.atlases, progress);
    const saved = await platform.saveFile({ kind: 'pdf', suggestedName: `${st.name || 'Untitled'}.pdf`, data });
    if (saved) editor.set({ status: `Saved PDF ${saved.name}.` });
  }), [editor, run]);

  const print = useCallback(() => run('Preparing to print…', async (progress) => {
    const images = await printImages(editor.getState().pages, editor.atlases, progress);
    editor.set({ busy: 'Waiting for the print dialog…' });
    const outcome = await platform.printPages(images);
    editor.set({ status: outcome?.success ? 'Sent to printer.' : 'Printing was cancelled.' });
  }), [editor, run]);

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
    if (found.chords) setDialog('review');
  }), [editor, run]);

  const loadSetlist = useCallback(async (setlist, progress) => {
    const songs = [];
    for (const name of setlist.songs) {
      if (!(await platform.library.exists(name))) continue;
      progress(`Loading ${name}…`);
      songs.push({ name, ...(await loadProject(await platform.library.read(name))) });
    }
    return songs;
  }, []);

  const setlistPdf = useCallback((setlist) => run('Building setlist…', async (progress) => {
    const data = await exportSetlistPdf(await loadSetlist(setlist, progress), progress);
    const saved = await platform.saveFile({ kind: 'pdf', suggestedName: `${setlist.name}.pdf`, data });
    if (saved) editor.set({ status: `Saved setlist PDF ${saved.name}.` });
  }), [editor, run, loadSetlist]);

  const setlistPrint = useCallback((setlist) => run('Building setlist…', async (progress) => {
    const images = [];
    for (const song of await loadSetlist(setlist, progress)) images.push(...(await printImages(song.pages, song.atlases, progress)));
    editor.set({ busy: 'Waiting for the print dialog…' });
    const outcome = await platform.printPages(images);
    editor.set({ status: outcome?.success ? `Setlist “${setlist.name}” sent to printer.` : 'Printing was cancelled.' });
  }), [editor, run, loadSetlist]);

  const stepZoom = useCallback((direction) => {
    const current = editor.getState().zoom;
    const next = direction > 0
      ? ZOOM_STEPS.find((z) => z > current + 0.001) ?? current
      : [...ZOOM_STEPS].reverse().find((z) => z < current - 0.001) ?? current;
    editor.set({ zoom: next });
  }, [editor]);

  useEffect(() => { platform.setDirty(state.dirty); }, [state.dirty]);
  useEffect(() => {
    platform.setTitle(`${state.name ? `${state.name}${state.dirty ? ' •' : ''} – ` : ''}ChartShift`);
  }, [state.name, state.dirty]);

  // Autosave: park unsaved work where it can be recovered after a crash or power cut.
  useEffect(() => {
    if (!state.dirty || !state.pages) return undefined;
    const timer = setTimeout(async () => {
      try {
        const st = editor.getState();
        const data = await saveProject({ pages: st.pages, atlases: editor.atlases, ids: editor.ids });
        await platform.recovery.save({ name: st.name, savedAs: st.savedAs }, data);
      } catch (error) { console.error('autosave failed', error); }
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [editor, state.pages, state.dirty]);

  // On start: offer back any work that was never saved; /?sample opens the sample (development).
  useEffect(() => {
    (async () => {
      if (new URLSearchParams(location.search).has('sample')) return openSample();
      const parked = await platform.recovery.load();
      if (!parked) return;
      if (window.confirm(`ChartShift closed with unsaved changes to “${parked.meta.name || 'Untitled'}”. Bring them back?`)) {
        const doc = await loadProject(parked.data);
        showDoc({ ...doc, name: parked.meta.name, savedAs: parked.meta.savedAs, status: 'Unsaved work restored. Save it to keep it.' });
        editor.set({ dirty: true });
      } else {
        await platform.recovery.clear();
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

  return (
    <div className="app">
      <a className="skip-link" href="#workspace">Skip to the page</a>
      <div className="toolbar" role="toolbar" aria-label="Main toolbar">
        <div className="group">
          <button type="button" onClick={open} title="Open a PDF, image, ChordPro file or song (Ctrl+O)">Open file</button>
          <button type="button" onClick={() => setDialog('library')} title="Saved songs and setlists (Ctrl+L)">Library</button>
          <button type="button" onClick={() => saveSong(false)} disabled={!hasDoc} title="Save to the library (Ctrl+S). Ctrl+Shift+S saves under a new name.">Save song</button>
          <button type="button" onClick={savePdf} disabled={!hasDoc} title="Save as a PDF (Ctrl+E)">Save as PDF</button>
          <button type="button" onClick={print} disabled={!hasDoc} title="Print (Ctrl+P)">Print</button>
        </div>
        <div className="group">
          <button type="button" onClick={editor.undo} disabled={!state.canUndo} title="Undo (Ctrl+Z)">Undo</button>
          <button type="button" onClick={editor.redo} disabled={!state.canRedo} title="Redo (Ctrl+Y)">Redo</button>
        </div>
        <Choice label="Tool" options={TOOLS} value={state.tool} onChange={(tool) => editor.set({ tool })} />
        <Choice label="Grab by" value={state.level} onChange={(level) => editor.set({ level })}
          options={LEVELS.map((id, i) => ({ id, label: id[0].toUpperCase() + id.slice(1), help: `${LEVEL_HELP[id]} (${i + 1})` }))} />
        <div className="group">
          <button type="button" onClick={editor.copy} disabled={none} title="Copy (Ctrl+C)">Copy</button>
          <button type="button" onClick={editor.paste} disabled={!hasDoc} title="Paste onto the current page (Ctrl+V)">Paste</button>
          <button type="button" onClick={editor.duplicateSelection} disabled={none} title="Duplicate (Ctrl+D)">Duplicate</button>
          <button type="button" onClick={editor.deleteSelection} disabled={none} title="Delete (Del)">Delete</button>
        </div>
        <div className="group">
          <button type="button" onClick={() => stepZoom(-1)} disabled={!hasDoc} aria-label="Zoom out" title="Zoom out (Ctrl+-)">−</button>
          <span className="zoom">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => stepZoom(1)} disabled={!hasDoc} aria-label="Zoom in" title="Zoom in (Ctrl++)">+</button>
          <button type="button" onClick={() => editor.set({ zoom: fitZoom(pages[0]) })} disabled={!hasDoc} title="Fit the page to the window width">Fit</button>
        </div>
      </div>

      {showText && (
        <div className="toolbar text-bar" role="toolbar" aria-label="Text box style">
          <label>Font
            <select value={style.font} onChange={(e) => editor.setTextStyle({ font: e.target.value })}>
              {FONTS.map((f) => <option key={f.css} value={f.css}>{f.label}</option>)}
            </select>
          </label>
          <label>Size
            <input type="number" min="4" max="144" step="1" value={style.size}
              onChange={(e) => { const size = Number(e.target.value); if (size >= 4 && size <= 144) editor.setTextStyle({ size }); }} />
          </label>
          <button type="button" aria-pressed={style.bold} className={style.bold ? 'on' : ''} onClick={() => editor.setTextStyle({ bold: !style.bold })}><b>Bold</b></button>
          <button type="button" aria-pressed={style.italic} className={style.italic ? 'on' : ''} onClick={() => editor.setTextStyle({ italic: !style.italic })}><i>Italic</i></button>
          <label>Colour
            <input type="color" value={style.color} onChange={(e) => editor.setTextStyle({ color: e.target.value })} />
          </label>
        </div>
      )}

      <div className="body">
        <main className="workspace" id="workspace" tabIndex={-1} ref={workspace} aria-busy={!!busy}>
          {hasDoc ? (
            <>
              <h1 className="sr-only">{state.name || 'Untitled song'}</h1>
              {pages.map((page, index) => (
                <PageView key={page.id} editor={editor} state={state} page={page} index={index} pageCount={pages.length} />
              ))}
            </>
          ) : (
            <div className="welcome">
              <h1>ChartShift</h1>
              <p>Open a chord chart, tab or sheet music PDF. Every line, word and letter becomes a piece you can drag around, erase or copy. Add your own text boxes, change the key, then save it as a PDF or print it.</p>
              <div className="welcome-actions">
                <button type="button" className="primary" onClick={open}>Open a PDF, image or song</button>
                <button type="button" onClick={() => setDialog('library')}>Song library</button>
                <button type="button" onClick={openSample}>Try the sample chart</button>
              </div>
            </div>
          )}
        </main>
        {hasDoc && (
          <Sidebar editor={editor} state={state} onReadText={readText} onReview={() => setDialog('review')} onChordPro={saveChordPro} />
        )}
      </div>

      <footer className="status">
        <span role="status" aria-live="polite">{busy || state.status}</span>
        {hasDoc && <span className="hint">Shift-drag: straight line · Alt-drag: no snapping · Arrows: nudge · . and , : next / previous</span>}
      </footer>

      {dialog === 'library' && (
        <LibraryDialog onClose={() => setDialog(null)} onOpenSong={openFromLibrary}
          onSetlistPdf={(s) => { setDialog(null); setlistPdf(s); }}
          onSetlistPrint={(s) => { setDialog(null); setlistPrint(s); }}
          notify={(status) => editor.set({ status })} />
      )}
      {dialog === 'review' && <ChordReviewDialog editor={editor} onClose={() => setDialog(null)} />}
      {dialog === 'saveName' && (
        <NameDialog title="Save song" label="Song name" initial={state.name || 'Untitled'} action="Save to library"
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            if (name !== state.savedAs && (await platform.library.exists(name))
              && !window.confirm(`The library already has a song called “${name}”. Replace it?`)) return;
            setDialog(null);
            await writeSong(name);
          }} />
      )}

      {busy && <div className="busy" aria-hidden="true"><div className="busy-card">{busy}</div></div>}
    </div>
  );
}
