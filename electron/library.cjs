// The song library: one folder holding every song (.chartshift) and setlist
// (.setlist.json). Keeping it to a single flat folder is what makes it easy to
// export, import, back up, or point at a cloud-synced folder.
const { app, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('fs');
const JSZip = require('jszip');

const SONG = '.chartshift';
const SETLIST = '.setlist.json';
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

// Names come from the renderer; never let one escape the library folder.
function safeName(name) {
  const clean = String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\.+$/, '').trim().slice(0, 120);
  if (!clean) throw new Error('That name cannot be used.');
  return clean;
}
const songPath = (name) => path.join(libraryDir(), safeName(name) + SONG);
const setlistPath = (name) => path.join(libraryDir(), safeName(name) + SETLIST);

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
        const data = JSON.parse(await fs.readFile(full, 'utf8'));
        setlists.push({ name: file.slice(0, -SETLIST.length), songs: Array.isArray(data.songs) ? data.songs.map(String) : [] });
      } catch { /* unreadable setlist: skip it */ }
    }
  }
  songs.sort((a, b) => a.name.localeCompare(b.name));
  setlists.sort((a, b) => a.name.localeCompare(b.name));
  return { songs, setlists };
}

const isLibraryFile = (file) => file.endsWith(SONG) || file.endsWith(SETLIST);

// Copies library files into `to`, never overwriting what is already there.
async function copyMissing(from, to) {
  let copied = 0;
  for (const file of await fs.readdir(from)) {
    if (!isLibraryFile(file) || existsSync(path.join(to, file))) continue;
    await fs.copyFile(path.join(from, file), path.join(to, file));
    copied++;
  }
  return copied;
}

function register(getWindow) {
  ipcMain.handle('library:info', info);
  ipcMain.handle('library:list', list);
  ipcMain.handle('library:read', (_e, name) => fs.readFile(songPath(name)));
  ipcMain.handle('library:exists', (_e, name) => existsSync(songPath(name)));
  ipcMain.handle('library:write', async (_e, name, data) => {
    // Write to a temp file first so a sync app never sees a half-written song.
    const target = songPath(name);
    await fs.writeFile(target + '.tmp', Buffer.from(data));
    await fs.rename(target + '.tmp', target);
    return safeName(name);
  });
  ipcMain.handle('library:remove', (_e, name) => shell.trashItem(songPath(name)));
  ipcMain.handle('library:rename', async (_e, from, to) => {
    if (existsSync(songPath(to))) throw new Error(`A song called “${safeName(to)}” already exists.`);
    await fs.rename(songPath(from), songPath(to));
    // Keep setlists pointing at the renamed song.
    const { setlists } = await list();
    for (const setlist of setlists) {
      if (!setlist.songs.includes(from)) continue;
      const songs = setlist.songs.map((s) => (s === from ? safeName(to) : s));
      await fs.writeFile(setlistPath(setlist.name), JSON.stringify({ songs }, null, 2));
    }
    return safeName(to);
  });
  ipcMain.handle('library:saveSetlist', async (_e, name, songs) => {
    await fs.writeFile(setlistPath(name), JSON.stringify({ songs: songs.map(String) }, null, 2));
    return safeName(name);
  });
  ipcMain.handle('library:removeSetlist', (_e, name) => shell.trashItem(setlistPath(name)));
  ipcMain.handle('library:reveal', () => shell.openPath(libraryDir()));

  ipcMain.handle('library:export', async () => {
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
    await fs.writeFile(result.filePath, await zip.generateAsync({ type: 'nodebuffer' }));
    return { path: result.filePath, count };
  });

  ipcMain.handle('library:import', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Import a library',
      properties: ['openFile'],
      filters: [{ name: 'Exported library', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePaths.length) return null;
    const zip = await JSZip.loadAsync(await fs.readFile(result.filePaths[0]));
    const dir = libraryDir();
    let added = 0, skipped = 0;
    for (const entry of Object.values(zip.files)) {
      const file = path.basename(entry.name);
      if (entry.dir || !isLibraryFile(file)) continue;
      const ext = file.endsWith(SONG) ? SONG : SETLIST;
      const target = path.join(dir, safeName(file.slice(0, -ext.length)) + ext);
      // Songs already here are kept; nothing is overwritten.
      if (existsSync(target)) { skipped++; continue; }
      await fs.writeFile(target, await entry.async('nodebuffer'));
      added++;
    }
    return { added, skipped };
  });

  // Moves the library to another folder: one picked in a dialog, or the
  // "ChartShift Library" folder inside a detected cloud folder.
  ipcMain.handle('library:setFolder', async (_e, cloudPath) => {
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
    if (path.resolve(target) === path.resolve(previous)) return { ...info(), copied: 0 };
    await fs.mkdir(target, { recursive: true });
    const copied = await copyMissing(previous, target);
    writeFileSync(settingsPath(), JSON.stringify({ ...readSettings(), libraryDir: target }, null, 2));
    return { ...info(), copied, previous };
  });

  // Crash recovery: the renderer parks unsaved work here every so often.
  const recoveryPath = () => path.join(app.getPath('userData'), 'recovery' + SONG);
  const recoveryMeta = () => path.join(app.getPath('userData'), 'recovery.json');
  ipcMain.handle('recovery:save', async (_e, meta, data) => {
    await fs.writeFile(recoveryPath(), Buffer.from(data));
    await fs.writeFile(recoveryMeta(), JSON.stringify(meta));
  });
  ipcMain.handle('recovery:load', async () => {
    try {
      const meta = JSON.parse(await fs.readFile(recoveryMeta(), 'utf8'));
      return { meta, data: await fs.readFile(recoveryPath()) };
    } catch { return null; }
  });
  ipcMain.handle('recovery:clear', async () => {
    await fs.rm(recoveryPath(), { force: true });
    await fs.rm(recoveryMeta(), { force: true });
  });
}

module.exports = { register, libraryDir };
