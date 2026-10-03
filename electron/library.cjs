// The song library: one folder holding every song (.chartshift) and setlist
// (.setlist.json). Keeping it to a single flat folder is what makes it easy to
// export, import, back up, or point at a cloud-synced folder.
const { app, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('fs');
const JSZip = require('jszip');
const { LIMITS, SONG_EXT: SONG, SETLIST_EXT: SETLIST, safeName, parseSetlist, planZipImport, createSerialQueue } = require('./safety.cjs');
const store = require('./songStore.cjs');

const { versionOf, writeAtomic, isLibraryFile } = store;

const FOLDER = 'ChartShift Library';

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

function readSettings() {
  try { return JSON.parse(readFileSync(settingsPath(), 'utf8')); } catch { return {}; }
}

function libraryDir() {
  // CHARTSHIFT_LIBRARY points tests at a throwaway folder.
  const dir = process.env.CHARTSHIFT_LIBRARY || readSettings().libraryDir || path.join(app.getPath('documents'), FOLDER);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

const songPath = (name) => path.join(libraryDir(), safeName(name) + SONG);
const setlistPath = (name) => path.join(libraryDir(), safeName(name) + SETLIST);

async function readSong(name) {
  const file = songPath(name);
  const { size } = await fs.stat(file);
  if (size > LIMITS.songBytes) throw new Error(`“${safeName(name)}” is too large to open.`);
  return fs.readFile(file);
}

// Folders that popular sync apps keep on this PC.
function cloudFolders() {
  const home = app.getPath('home');
  const found = [];
  const add = (name, dir) => { if (dir && existsSync(dir) && !found.some((f) => f.path === dir)) found.push({ name, path: dir }); };
  add('OneDrive', process.env.OneDriveConsumer || process.env.OneDrive);
  add('OneDrive (work)', process.env.OneDriveCommercial);
  add('Google Drive', path.join(home, 'Google Drive'));
  for (const letter of 'GHIJKLMNOPQRSTUVWXYZDEF') add('Google Drive', `${letter}:\\My Drive`);
  add('Dropbox', path.join(home, 'Dropbox'));
  add('iCloud Drive', path.join(home, 'iCloudDrive'));
  return found;
}

const info = () => ({ dir: libraryDir(), clouds: cloudFolders() });

async function list() {
  const dir = libraryDir();
  const songs = [], setlists = [];
  for (const file of await fs.readdir(dir)) {
    const full = path.join(dir, file);
    if (file.endsWith(SONG)) {
      const stat = await fs.stat(full);
      songs.push({ name: file.slice(0, -SONG.length), modified: stat.mtimeMs, size: stat.size });
    } else if (file.endsWith(SETLIST)) {
      try {
        if ((await fs.stat(full)).size > LIMITS.setlistBytes) continue;
        setlists.push({ name: file.slice(0, -SETLIST.length), ...parseSetlist(await fs.readFile(full, 'utf8')) });
      } catch { /* unreadable setlist: skip it */ }
    }
  }
  songs.sort((a, b) => a.name.localeCompare(b.name));
  setlists.sort((a, b) => a.name.localeCompare(b.name));
  return { songs, setlists };
}

// Saving goes through songStore.writeSong, which never destroys a version of a
// song it has not seen. Replacing an unrelated song of the same name sends the
// old one to the Recycle Bin.
const writeSong = (name, data, options) => store.writeSong(libraryDir(), name, data, options, { trash: (file) => shell.trashItem(file) });

// Crash recovery: the renderer parks unsaved work here every so often.
// The small meta file is written last and removed first, so its presence means
// a complete recovery file; saves and clears run strictly one at a time.
const recoveryQueue = createSerialQueue();
const recoveryPath = () => path.join(app.getPath('userData'), 'recovery' + SONG);
const recoveryMeta = () => path.join(app.getPath('userData'), 'recovery.json');
const saveRecovery = (meta, data) => recoveryQueue(async () => {
  const buffer = Buffer.from(data);
  if (buffer.length > LIMITS.songBytes) throw new Error('Too large to autosave.');
  await fs.rm(recoveryMeta(), { force: true });
  await writeAtomic(recoveryPath(), buffer);
  await writeAtomic(recoveryMeta(), Buffer.from(JSON.stringify({
    name: String(meta?.name || '').slice(0, 120),
    savedAs: meta?.savedAs ? String(meta.savedAs).slice(0, 120) : null,
    baseVersion: typeof meta?.baseVersion === 'string' ? meta.baseVersion.slice(0, 64) : null,
  })));
});
const loadRecovery = () => recoveryQueue(async () => {
  try {
    const meta = JSON.parse(await fs.readFile(recoveryMeta(), 'utf8'));
    return { meta, data: await fs.readFile(recoveryPath()) };
  } catch { return null; }
});
const clearRecovery = () => recoveryQueue(async () => {
  await fs.rm(recoveryMeta(), { force: true });
  await fs.rm(recoveryPath(), { force: true });
});

/** `handle(channel, listener)` registers an IPC handler that checks the sender. */
function register(getWindow, handle) {
  // A save interrupted by a crash or power cut may have left a version set
  // aside; bring any such file back as a visible "recovered copy".
  const tidy = () => store.recoverOrphans(libraryDir()).catch(() => []);
  app.whenReady().then(tidy);

  handle('library:info', info);
  handle('library:list', async () => { await tidy(); return list(); });
  handle('library:read', async (_e, name) => {
    const data = await readSong(name);
    return { data, version: versionOf(data) };
  });
  handle('library:exists', (_e, name) => existsSync(songPath(name)));
  handle('library:write', (_e, name, data, options) => writeSong(name, data, options || {}));
  handle('library:remove', (_e, name) => shell.trashItem(songPath(name)));
  handle('library:rename', async (_e, from, to) => {
    // An exclusive rename: it fails rather than overwriting a song of that name.
    if (!(await store.renameExclusive(songPath(from), songPath(to)))) throw new Error(`A song called “${safeName(to)}” already exists.`);
    // Keep setlists pointing at the renamed song.
    const { setlists } = await list();
    for (const setlist of setlists) {
      if (!setlist.songs.includes(from)) continue;
      const songs = setlist.songs.map((s) => (s === from ? safeName(to) : s));
      await writeAtomic(setlistPath(setlist.name), Buffer.from(JSON.stringify({ songs }, null, 2)));
    }
    return safeName(to);
  });
  handle('library:saveSetlist', async (_e, name, songs) => {
    if (!Array.isArray(songs) || songs.length > LIMITS.setlistSongs) throw new Error('That setlist has too many songs.');
    await writeAtomic(setlistPath(name), Buffer.from(JSON.stringify({ songs: songs.map((s) => String(s).slice(0, 120)) }, null, 2)));
    return safeName(name);
  });
  handle('library:removeSetlist', (_e, name) => shell.trashItem(setlistPath(name)));
  handle('library:reveal', () => shell.openPath(libraryDir()));

  handle('library:export', async () => {
    const dir = libraryDir();
    const stamp = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog(getWindow(), {
      title: 'Export the whole library',
      defaultPath: path.join(app.getPath('documents'), `ChartShift Library ${stamp}.zip`),
      filters: [{ name: 'Zip archive', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePath) return null;
    const zip = new JSZip();
    let count = 0;
    for (const file of await fs.readdir(dir)) {
      if (!isLibraryFile(file)) continue;
      zip.file(file, await fs.readFile(path.join(dir, file)), { compression: 'STORE' });
      count++;
    }
    await writeAtomic(result.filePath, await zip.generateAsync({ type: 'nodebuffer' }));
    return { path: result.filePath, count };
  });

  handle('library:import', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Import a library',
      properties: ['openFile'],
      filters: [{ name: 'Exported library', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePaths.length) return null;
    const source = result.filePaths[0];
    if ((await fs.stat(source)).size > LIMITS.zipBytes) throw new Error('That file is too large to be a ChartShift library export.');
    let zip;
    try { zip = await JSZip.loadAsync(await fs.readFile(source)); } catch { throw new Error('That file is not a zip archive, or it is damaged.'); }
    const entries = Object.values(zip.files).map((entry) => ({ name: entry.name, dir: entry.dir, size: entry._data?.uncompressedSize ?? 0, entry }));
    const { accept, rejected } = planZipImport(entries);
    const files = [];
    for (const { entry, file } of accept) {
      const cap = file.endsWith(SONG) ? LIMITS.songBytes : LIMITS.setlistBytes;
      const buffer = await entry.entry.async('nodebuffer');
      // The size in a zip's directory can lie; check what actually came out.
      if (buffer.length > cap) { rejected.push({ name: file, reason: 'it is too large' }); continue; }
      if (file.endsWith(SETLIST)) {
        try { parseSetlist(buffer.toString('utf8')); } catch { rejected.push({ name: file, reason: 'it is not a valid setlist' }); continue; }
      } else if (buffer.length < 4 || (buffer.readUInt32LE(0) !== 0x04034b50 && buffer.readUInt32LE(0) !== 0x06054b50)) {
        rejected.push({ name: file, reason: 'it is not a ChartShift song' });
        continue;
      }
      files.push({ file, read: async () => buffer });
    }
    // Same rule as moving folders: nothing here is overwritten, and a different
    // song of the same name is added beside it as an "imported copy".
    const merged = await store.mergeInto(libraryDir(), files, 'imported copy');
    return { ...merged, rejected: rejected.slice(0, 20), rejectedCount: rejected.length };
  });

  // Moves the library to another folder: one picked in a dialog, or the
  // "ChartShift Library" folder inside a detected cloud folder.
  handle('library:setFolder', async (_e, cloudPath) => {
    let target;
    if (cloudPath) {
      const cloud = cloudFolders().find((c) => c.path === cloudPath);
      if (!cloud) throw new Error('That folder is no longer available.');
      target = path.join(cloud.path, FOLDER);
    } else {
      const result = await dialog.showOpenDialog(getWindow(), {
        title: 'Choose the library folder',
        defaultPath: libraryDir(),
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled || !result.filePaths.length) return null;
      target = result.filePaths[0];
    }
    const previous = libraryDir();
    if (path.resolve(target) === path.resolve(previous)) return { ...info(), unchanged: true };
    await fs.mkdir(target, { recursive: true });
    // Copy first, switch only once every file is safely across. A same-named
    // file with different contents is never skipped or overwritten: both are
    // kept (see songStore.mergeInto). The previous folder is left untouched.
    const merged = await store.migrateLibrary(previous, target);
    writeFileSync(settingsPath(), JSON.stringify({ ...readSettings(), libraryDir: target }, null, 2));
    return { ...info(), ...merged, previous };
  });

  handle('recovery:save', (_e, meta, data) => saveRecovery(meta, data));
  handle('recovery:load', loadRecovery);
  handle('recovery:clear', clearRecovery);
}

module.exports = { register, libraryDir, clearRecovery };
