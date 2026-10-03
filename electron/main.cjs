const { app, BrowserWindow, dialog, ipcMain, protocol, net, Menu } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs/promises');
const { pathToFileURL } = require('url');
const library = require('./library.cjs');

const DEV = !!process.env.CHARTSHIFT_DEV;
// Smoke test: open the sample chart, save a screenshot, exit. Used by `npm run smoke`.
const SMOKE = process.env.CHARTSHIFT_SMOKE;
const DIST = path.join(__dirname, '..', 'dist');

const OPEN_FILTERS = [
  { name: 'Songs, PDFs, images and ChordPro', extensions: ['chartshift', 'pdf', 'png', 'jpg', 'jpeg', 'cho', 'chopro', 'crd', 'pro'] },
  { name: 'ChartShift songs', extensions: ['chartshift'] },
  { name: 'PDF documents', extensions: ['pdf'] },
  { name: 'Images', extensions: ['png', 'jpg', 'jpeg'] },
  { name: 'ChordPro', extensions: ['cho', 'chopro', 'crd', 'pro'] },
];
const SAVE_KINDS = {
  pdf: { title: 'Save as PDF', filters: [{ name: 'PDF document', extensions: ['pdf'] }] },
  cho: { title: 'Export ChordPro', filters: [{ name: 'ChordPro', extensions: ['cho'] }] },
};
let win = null;
let dirty = false;

if (SMOKE) {
  const scratch = require('fs').mkdtempSync(path.join(os.tmpdir(), 'chartshift-smoke-'));
  app.setPath('userData', path.join(scratch, 'userData'));
  process.env.CHARTSHIFT_LIBRARY = path.join(scratch, 'library');
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 950,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#d5d9de',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    title: 'ChartShift',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadURL(DEV ? 'http://localhost:5183' : `app://chartshift/index.html${SMOKE ? '?sample' : ''}`);
  if (SMOKE) runSmoke();
  win.on('close', (event) => {
    if (!dirty) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Keep editing', 'Close without saving'],
      defaultId: 0,
      cancelId: 0,
      message: 'This song has changes that are not saved.',
      detail: 'Close ChartShift anyway?',
    });
    if (choice === 0) event.preventDefault();
  });
  win.on('closed', () => { win = null; });
}

function runSmoke() {
  const fail = setTimeout(() => { console.error('SMOKE FAIL: sample did not open'); app.exit(1); }, 30000);
  win.on('page-title-updated', async (_e, title) => {
    if (!title.startsWith('Sample chart')) return;
    clearTimeout(fail);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const image = await win.webContents.capturePage();
    await fs.writeFile(SMOKE, image.toPNG());
    // Exercise the real library and recovery plumbing (in throwaway folders).
    const report = await win.webContents.executeJavaScript(`(async () => {
      const lib = window.chartshift.library, rec = window.chartshift.recovery;
      const bytes = new Uint8Array([80, 75, 5, 6]);
      await lib.write('Smoke song', bytes);
      await lib.rename('Smoke song', 'Smoke song 2');
      await lib.saveSetlist('Smoke set', ['Smoke song 2']);
      const listed = await lib.list();
      const back = await lib.read('Smoke song 2');
      await rec.save({ name: 'x' }, bytes);
      const parked = await rec.load();
      await rec.clear();
      return {
        status: document.querySelector('[role=status]').textContent,
        songs: listed.songs.map((s) => s.name), setlists: listed.setlists,
        readBack: back.length, recovered: parked && parked.meta.name, cleared: (await rec.load()) === null,
        dir: (await lib.info()).dir,
      };
    })()`);
    console.log('SMOKE OK:', JSON.stringify(report));
    app.exit(0);
  });
}

ipcMain.on('dirty', (_e, value) => { dirty = !!value; });
ipcMain.on('title', (_e, title) => { if (win) win.setTitle(String(title).slice(0, 200)); });

ipcMain.handle('file:open', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Open a song, PDF or image',
    defaultPath: app.getPath('documents'),
    properties: ['openFile'],
    filters: OPEN_FILTERS,
  });
  if (result.canceled || !result.filePaths.length) return null;
  const filePath = result.filePaths[0];
  return { name: path.basename(filePath), data: await fs.readFile(filePath) };
});

// Files that leave the library (PDFs, ChordPro) always go through a Save dialog.
ipcMain.handle('file:save', async (_e, { kind, suggestedName, data }) => {
  const options = SAVE_KINDS[kind];
  if (!options) throw new Error('Unknown file type.');
  const result = await dialog.showSaveDialog(win, {
    title: options.title,
    defaultPath: path.join(app.getPath('documents'), suggestedName),
    filters: options.filters,
  });
  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, Buffer.from(data));
  return { name: path.basename(result.filePath) };
});

library.register(() => win);

// Printing: lay the page images out in a hidden window and hand it to the
// normal Windows print dialog, so any installed printer works.
ipcMain.handle('print', async (_e, pages) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chartshift-print-'));
  const inches = (n) => Number(n).toFixed(3) + 'in';
  try {
    const blocks = [];
    for (let i = 0; i < pages.length; i++) {
      await fs.writeFile(path.join(dir, `page-${i}.png`), Buffer.from(pages[i].png));
      blocks.push(
        `<div class="page" style="width:${inches(pages[i].widthIn)};height:${inches(pages[i].heightIn)}">` +
        `<img src="page-${i}.png" alt=""></div>`,
      );
    }
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>ChartShift</title><style>
      @page { size: ${inches(pages[0].widthIn)} ${inches(pages[0].heightIn)}; margin: 0; }
      html, body { margin: 0; padding: 0; }
      .page { break-after: page; overflow: hidden; }
      .page:last-child { break-after: auto; }
      img { width: 100%; height: 100%; display: block; }
    </style></head><body>${blocks.join('')}</body></html>`;
    const htmlPath = path.join(dir, 'print.html');
    await fs.writeFile(htmlPath, html);

    const printWin = new BrowserWindow({ show: false, parent: win, webPreferences: { sandbox: true } });
    await printWin.loadURL(pathToFileURL(htmlPath).toString());
    const outcome = await new Promise((resolve) => {
      printWin.webContents.print(
        { silent: false, printBackground: true, margins: { marginType: 'none' } },
        (success, reason) => resolve({ success, reason }),
      );
    });
    printWin.destroy();
    return outcome;
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const target = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    if (!target.startsWith(DIST)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(target).toString());
  });
  if (!DEV) Menu.setApplicationMenu(null);
  createWindow();
});

app.on('window-all-closed', () => app.quit());
