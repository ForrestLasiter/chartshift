// Written songs: the page is laid out from the song's text (lyrics with
// [chords], headings on their own lines) and is laid out again whenever the
// text or its header facts change. `state.write` holds
//   { meta: { title, artist, key, tempo, time, capo }, text, diagrams, drafts }
import { layoutChordPro, parseChordPro } from '../lib/chordpro.js';
import { EMPTY_META, mapChords, transposeText } from '../lib/songtext.js';
import { keyName, keyOf, noteName, parseKey, prefersFlats, toNashville } from '../lib/chords.js';

const MAX_DRAFTS = 30;

/** Pages for a written song. `pageIds` keeps page identity stable between layouts. */
export function layoutWritten(write, ids, pageIds = []) {
  const song = parseChordPro(write.text);
  const { meta } = write;
  Object.assign(song, {
    title: meta.title, subtitle: meta.artist, key: meta.key, time: meta.time, capo: meta.capo,
    tempo: meta.tempo ? `${meta.tempo} bpm` : '',
  });
  const pages = layoutChordPro(song, ids, { diagrams: write.diagrams || null });
  pages.forEach((page, i) => { if (pageIds[i] != null) page.id = pageIds[i]; });
  return pages;
}

export const newWrite = (meta = {}, text = '') => ({ meta: { ...EMPTY_META, ...meta }, text, diagrams: null, drafts: [] });

export function installWriting(ed) {
  const state = () => ed.getState();

  /** Opens a written song as the current document. */
  ed.startWriting = (write, { name, savedAs = null, baseVersion = null, status } = {}) => {
    const ids = { piece: 1, group: 1, page: 1 };
    const pages = layoutWritten(write, ids);
    ed.setDoc({ pages, atlases: [], ids, name: name || write.meta.title || 'Untitled song', savedAs, baseVersion, write, status: status || 'New song. Type the words on the Write tab; put chords in [square brackets].' });
  };

  /** Changes the song's text, facts or options and lays the page out again. */
  ed.setWrite = (patch, status) => {
    const current = state().write;
    if (!current) return;
    const write = { ...current, ...patch, meta: { ...current.meta, ...(patch.meta || {}) } };
    const pages = layoutWritten(write, ed.ids, state().pages.map((p) => p.id));
    // The page now comes from the text again, so earlier page edits no longer apply.
    ed.clearHistory();
    const naming = !state().savedAs && patch.meta && 'title' in patch.meta ? { name: write.meta.title || 'Untitled song' } : null;
    ed.set({ write, pages, selection: new Set(), editing: null, dirty: true, layoutEdited: false, activePage: Math.min(state().activePage, pages.length - 1), ...naming, ...(status ? { status } : null) });
  };

  /** The song's key: the one written in its facts, or else guessed from its first chord. */
  ed.writtenKey = () => {
    const write = state().write;
    if (!write) return null;
    const fromFacts = parseKey(write.meta.key);
    if (fromFacts) return fromFacts;
    const first = write.text.match(/\[([A-G][^\]\n]*)\]/);
    return first ? keyOf(first[1]) : null;
  };

  ed.transposeWritten = (semitones, spelling = 'auto') => {
    const write = state().write;
    const key = ed.writtenKey();
    if (!key) return ed.set({ status: 'There are no chords to transpose yet.' });
    const target = { index: (key.index + semitones + 120) % 12, minor: key.minor };
    const useFlats = spelling === 'auto' ? prefersFlats(target) : spelling === 'flats';
    const to = noteName(target.index, useFlats) + (key.minor ? 'm' : '');
    ed.setWrite(
      { text: transposeText(write.text, semitones, useFlats), meta: parseKey(write.meta.key) ? { key: to } : {} },
      `Transposed from ${keyName(key)} to ${to}.`,
    );
  };

  ed.nashvilleWritten = () => {
    const key = ed.writtenKey();
    if (!key) return ed.set({ status: 'There are no chords to change yet.' });
    ed.setWrite({ text: mapChords(state().write.text, (chord) => toNashville(chord, key)) }, `Chords changed to Nashville numbers in ${keyName(key)}.`);
  };

  // Capo: the chords drop to the shapes to play, and the header says "Capo N".
  ed.capoWritten = (fret) => {
    const write = state().write;
    const key = ed.writtenKey();
    if (!key) return ed.set({ status: 'There are no chords yet.' });
    const shapes = { index: (key.index - fret + 120) % 12, minor: key.minor };
    ed.setWrite({ text: transposeText(write.text, -fret, prefersFlats(shapes)), meta: { capo: String(fret) } }, `Capo ${fret}: chords now show the shapes to play.`);
  };

  // --- drafts: named copies of the words, kept inside the song ----------------

  ed.saveDraft = (name) => {
    const write = state().write;
    const label = name.trim() || `Draft ${write.drafts.length + 1}`;
    const draft = { name: label.slice(0, 80), saved: new Date().toISOString(), text: write.text, meta: { ...write.meta } };
    ed.setWrite({ drafts: [draft, ...write.drafts].slice(0, MAX_DRAFTS) }, `Draft “${draft.name}” saved.`);
  };

  ed.restoreDraft = (index) => {
    const write = state().write;
    const draft = write.drafts[index];
    if (!draft) return;
    // What is on the page now is kept as a draft first, so restoring never loses work.
    const backup = { name: 'Before restoring', saved: new Date().toISOString(), text: write.text, meta: { ...write.meta } };
    const drafts = [backup, ...write.drafts.filter((d) => d.name !== 'Before restoring')].slice(0, MAX_DRAFTS);
    ed.setWrite({ text: draft.text, meta: { ...draft.meta }, drafts }, `Draft “${draft.name}” restored. The version you had is kept as “Before restoring”.`);
  };

  ed.deleteDraft = (index) => {
    const write = state().write;
    ed.setWrite({ drafts: write.drafts.filter((_, i) => i !== index) }, 'Draft deleted.');
  };
}
