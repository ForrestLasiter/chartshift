// File, library and print access. In the installed app these go through
// Electron; in a plain browser (used for development) they fall back to web
// APIs and a library that only lives in memory.
const api = window.chartshift;

export const isDesktop = !!api;

export async function openFile() {
  if (api) return api.openFile();
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.chartshift,.pdf,.png,.jpg,.jpeg,.cho,.chopro,.crd,.pro';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return resolve(null);
      resolve({ name: file.name, data: new Uint8Array(await file.arrayBuffer()) });
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Lets the user choose a recording. Resolves { name, data } or null. */
export async function openAudio() {
  if (api) return api.openAudio();
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.onchange = async () => {
      const file = input.files[0];
      resolve(file ? { name: file.name, data: new Uint8Array(await file.arrayBuffer()) } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Saves a file that leaves the library. kind: 'pdf' | 'cho'. */
export async function saveFile({ kind, suggestedName, data }) {
  if (api) return api.saveFile({ kind, suggestedName, data });
  const type = kind === 'pdf' ? 'application/pdf' : 'text/plain';
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return { name: suggestedName };
}

export async function printPages(pages) {
  if (api) return api.print(pages);
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.body.style.margin = '0';
  for (const page of pages) {
    const img = doc.createElement('img');
    img.src = URL.createObjectURL(new Blob([page.png], { type: 'image/png' }));
    img.style.cssText = 'width:100%;display:block;break-after:page';
    doc.body.appendChild(img);
    await img.decode();
  }
  frame.contentWindow.print();
  setTimeout(() => frame.remove(), 60000);
  return { success: true };
}

export function setDirty(dirty) {
  if (api) api.setDirty(dirty);
}

export function setTitle(title) {
  document.title = title;
  if (api) api.setTitle(title);
}

// --- browser stand-ins ------------------------------------------------------

// Mirrors the desktop library's conflict rules (see electron/library.cjs).
function memoryLibrary() {
  const songs = new Map();
  const setlists = new Map();
  let counter = 0;
  const put = (name, data) => { const version = `v${++counter}`; songs.set(name, { data, modified: Date.now(), version }); return version; };
  return {
    info: async () => ({ dir: '(browser preview: songs are kept in memory only)', clouds: [] }),
    list: async () => ({
      songs: [...songs].map(([name, s]) => ({ name, modified: s.modified, size: s.data.length })).sort((a, b) => a.name.localeCompare(b.name)),
      setlists: [...setlists].map(([name, list]) => ({ name, songs: list })).sort((a, b) => a.name.localeCompare(b.name)),
    }),
    read: async (name) => ({ data: songs.get(name).data, version: songs.get(name).version }),
    exists: async (name) => songs.has(name),
    write: async (name, data, { expect = null, onConflict = 'ask' } = {}) => {
      const current = songs.get(name);
      const verdict = !current ? 'write' : expect != null ? (current.version === expect ? 'write' : 'changed') : 'exists';
      const kept = [];
      if (verdict !== 'write') {
        if (onConflict === 'copy') { const copy = `${name} (my copy ${counter + 1})`; return { name: copy, version: put(copy, data), savedAsCopy: true, kept: null }; }
        if (onConflict !== 'replace') return { conflict: { reason: verdict, name, modified: current.modified } };
        if (verdict === 'changed') { kept.push(`${name} (conflict copy ${counter + 1})`); songs.set(kept[0], current); }
      }
      return { name, version: put(name, data), kept: kept.length ? kept : null };
    },
    remove: async (name) => { songs.delete(name); },
    rename: async (from, to) => {
      if (songs.has(to)) throw new Error(`A song called “${to}” already exists.`);
      songs.set(to, songs.get(from));
      songs.delete(from);
      for (const [name, list] of setlists) setlists.set(name, list.map((s) => (s === from ? to : s)));
      return to;
    },
    saveSetlist: async (name, list) => { setlists.set(name, list.slice()); return name; },
    removeSetlist: async (name) => { setlists.delete(name); },
    reveal: async () => {},
    exportAll: async () => null,
    importAll: async () => null,
    setFolder: async () => null,
  };
}

export const library = api?.library ?? memoryLibrary();

export const recovery = api?.recovery ?? { save: async () => {}, load: async () => null, clear: async () => {} };

/** Checking for and installing updates; null where that is not possible (the browser preview). */
export const update = api?.update ?? null;
