const { app, BrowserWindow, dialog, ipcMain, protocol, net, Menu, session } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs/promises');
const { pathToFileURL } = require('url');
const library = require('./library.cjs');
const safety = require('./safety.cjs');
const update = require('./update.cjs');
const { spawn } = require('child_process');

const DEV = !!process.env.CHARTSHIFT_DEV;
// Test runs (see harness.cjs): smoke checks, or screenshots of the main screens.
const SMOKE = process.env.CHARTSHIFT_SMOKE;
const SHOTS = process.env.CHARTSHIFT_SHOTS;
const TESTING = !!(SMOKE || SHOTS);
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
let quittingToUpdate = false;

if (TESTING) {
  const scratch = require('fs').mkdtempSync(path.join(os.tmpdir(), 'chartshift-smoke-'));
  app.setPath('userData', path.join(scratch, 'userData'));
  process.env.CHARTSHIFT_LIBRARY = path.join(scratch, 'library');
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// Privileged requests are only honoured from the app's own page in the main
// window's top frame - never from a sub-frame, another window, or a page the
// window was somehow navigated to.
function isTrustedSender(event) {
  const frame = event.senderFrame;
  return !!win && !!frame && event.sender === win.webContents
    && frame === win.webContents.mainFrame && safety.isTrustedUrl(frame.url, DEV);
}
function handle(channel, listener) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error('Request refused.');
    return listener(event, ...args);
  });
}
function listen(channel, listener) {
  ipcMain.on(channel, (event, ...args) => { if (isTrustedSender(event)) listener(event, ...args); });
}

// Every window and frame: no pop-ups, no leaving the app, no embedded webviews.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const block = (event, url) => { if (!safety.isTrustedUrl(url, DEV)) event.preventDefault(); };
  contents.on('will-navigate', block);
  contents.on('will-redirect', block);
  contents.on('will-frame-navigate', (event) => { if (!safety.isTrustedUrl(event.url, DEV)) event.preventDefault(); });
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

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
  win.loadURL(DEV ? 'http://localhost:5183' : `app://chartshift/index.html${TESTING ? '?sample&debug' : ''}`);
  if (TESTING) {
    const harness = require('./harness.cjs');
    const preload = path.join(__dirname, 'preload.cjs');
    if (SMOKE) harness.runSmoke(win, { output: SMOKE, withPrintWindow, preload });
    else harness.runShots(win, { folder: SHOTS });
  }
  win.on('close', (event) => {
    if (!dirty || TESTING || quittingToUpdate) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Keep editing', 'Close without saving'],
      defaultId: 0,
      cancelId: 0,
      message: 'This song has changes that are not saved.',
      detail: 'Close ChartShift anyway?',
    });
    if (choice === 0) event.preventDefault();
    // The user chose to throw the changes away, so do not offer them back next time.
    else library.clearRecovery();
  });
  win.on('closed', () => { win = null; });
}

listen('dirty', (_e, value) => { dirty = !!value; });
listen('title', (_e, title) => { if (win) win.setTitle(String(title).slice(0, 200)); });

handle('file:open', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Open a song, PDF or image',
    defaultPath: app.getPath('documents'),
    properties: ['openFile'],
    filters: OPEN_FILTERS,
  });
  if (result.canceled || !result.filePaths.length) return null;
  const filePath = result.filePaths[0];
  const { size } = await fs.stat(filePath);
  if (size > safety.LIMITS.songBytes) throw new Error(`${path.basename(filePath)} is too large to open (over ${Math.round(safety.LIMITS.songBytes / 1048576)} MB).`);
  return { name: path.basename(filePath), data: await fs.readFile(filePath) };
});

handle('audio:open', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Choose a recording',
    defaultPath: app.getPath('music'),
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'webm', 'wma'] }],
  });
  if (result.canceled || !result.filePaths.length) return null;
  const filePath = result.filePaths[0];
  if ((await fs.stat(filePath)).size > safety.LIMITS.audioBytes) throw new Error('That recording is too large (over 200 MB).');
  return { name: path.basename(filePath), data: await fs.readFile(filePath) };
});

// Files that leave the library (PDFs, ChordPro) always go through a Save dialog.
handle('file:save', async (_e, { kind, suggestedName, data }) => {
  const options = SAVE_KINDS[kind];
  if (!options) throw new Error('Unknown file type.');
  if (!data || data.byteLength > safety.LIMITS.exportBytes) throw new Error('That file is too large to save.');
  const result = await dialog.showSaveDialog(win, {
    title: options.title,
    defaultPath: path.join(app.getPath('documents'), safety.safeName(path.basename(String(suggestedName)))),
    filters: options.filters,
  });
  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, Buffer.from(data));
  return { name: path.basename(result.filePath) };
});

library.register(() => win, handle);

// Updates: ask GitHub for the latest release, download its installer, start it.
// The page only ever names the step; what is downloaded and what is run are
// decided here, from GitHub's answer (see update.cjs).
let latestInstaller = null;
let downloadedInstaller = null;
handle('update:check', async () => {
  latestInstaller = await update.checkLatest(net.fetch, app.getVersion());
  const { url, sha256, ...shown } = latestInstaller;
  return { ...shown, canInstall: app.isPackaged };
});
handle('update:download', async () => {
  if (!latestInstaller || !latestInstaller.available) throw new Error('There is no update to download.');
  let last = 0;
  const result = await update.downloadInstaller(latestInstaller, path.join(app.getPath('temp'), 'ChartShift-update'), {
    fetchImpl: net.fetch,
    onProgress: (received, total) => {
      const now = Date.now();
      if (now - last < 150 && received < total) return;
      last = now;
      if (win && !win.isDestroyed()) win.webContents.send('update:progress', { received, total });
    },
  });
  downloadedInstaller = result.path;
  return { verified: result.verified };
});
handle('update:install', async () => {
  if (!downloadedInstaller) throw new Error('The update has not been downloaded yet.');
  if (!app.isPackaged) throw new Error('This copy is running from source, so it cannot install an update over itself. Use git pull instead.');
  // Start the installer on its own, then close so it can replace the app's files.
  spawn(downloadedInstaller, [], { detached: true, stdio: 'ignore' }).unref();
  quittingToUpdate = true;
  setTimeout(() => app.quit(), 400);
  return true;
});

// Printing: lay the page images out in a hidden window and hand it to the
// normal Windows print dialog, so any installed printer works. Sheets may
// differ in size or orientation; see safety.buildPrintHtml.
async function withPrintWindow(pages, use) {
  const sizes = safety.checkPrintPages(pages);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chartshift-print-'));
  let printWin = null;
  try {
    for (let i = 0; i < pages.length; i++) await fs.writeFile(path.join(dir, `page-${i}.png`), Buffer.from(pages[i].png));
    const { html, uniform } = safety.buildPrintHtml(sizes);
    const htmlPath = path.join(dir, 'print.html');
    await fs.writeFile(htmlPath, html);
    printWin = new BrowserWindow({ show: false, parent: win || undefined, webPreferences: { sandbox: true, javascript: false } });
    await printWin.loadURL(pathToFileURL(htmlPath).toString());
    return await use(printWin, uniform);
  } finally {
    if (printWin && !printWin.isDestroyed()) printWin.destroy();
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

handle('print', (_e, pages) => withPrintWindow(pages, (printWin, uniform) => new Promise((resolve) => {
  const options = { silent: false, printBackground: true, margins: { marginType: 'none' } };
  if (uniform) {
    // One sheet size for the whole job: tell the printer exactly which.
    const short = Math.min(uniform.widthIn, uniform.heightIn), long = Math.max(uniform.widthIn, uniform.heightIn);
    options.pageSize = { width: Math.round(short * 25400), height: Math.round(long * 25400) };
    options.landscape = uniform.widthIn > uniform.heightIn;
  }
  printWin.webContents.print(options, (success, reason) => resolve({ success, reason }));
})));

app.whenReady().then(() => {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    const target = url.host === 'chartshift' ? safety.resolveAppPath(DIST, url.pathname) : null;
    if (!target) return new Response('Forbidden', { status: 403 });
    const response = await net.fetch(pathToFileURL(target).toString());
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', safety.CONTENT_SECURITY_POLICY);
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(response.body, { status: response.status, headers });
  });
  // Everything is refused except the microphone (sound only) for the app's own
  // page, which "Chords from a recording" needs. No camera, location or the rest.
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(!!win && contents === win.webContents
      && safety.allowPermission({ permission, mediaTypes: details.mediaTypes, url: details.requestingUrl }, DEV));
  });
  session.defaultSession.setPermissionCheckHandler((contents, permission, origin, details) => !!win && contents === win.webContents
    && safety.allowPermission({ permission, mediaTypes: [details.mediaType], url: origin }, DEV));
  if (!DEV) Menu.setApplicationMenu(null);
  createWindow();
});

app.on('window-all-closed', () => app.quit());
