// Draws assets/icon.png (512x512). Run with: npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#1e3a8a"/>
  <rect x="72" y="60" width="368" height="392" rx="28" fill="#ffffff"/>
  <g fill="#1e3a8a">
    <rect x="112" y="118" width="60" height="22" rx="8"/>
    <rect x="236" y="118" width="60" height="22" rx="8"/>
    <rect x="112" y="160" width="288" height="22" rx="8" fill="#94a3b8"/>
    <rect x="112" y="352" width="60" height="22" rx="8"/>
    <rect x="300" y="352" width="60" height="22" rx="8"/>
    <rect x="112" y="394" width="288" height="22" rx="8" fill="#94a3b8"/>
  </g>
  <g fill="#f59e0b">
    <rect x="150" y="236" width="60" height="22" rx="8"/>
    <rect x="274" y="236" width="60" height="22" rx="8"/>
    <rect x="150" y="278" width="250" height="22" rx="8"/>
    <path d="M84 268 l44 -34 v22 h14 v24 h-14 v22 z"/>
  </g>
</svg>`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 512, height: 512, useContentSize: true, transparent: true, frame: false, webPreferences: { offscreen: true } });
  await win.loadURL(`data:text/html,<body style="margin:0;background:transparent">${encodeURIComponent(svg)}</body>`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const image = (await win.webContents.capturePage()).resize({ width: 512, height: 512 });
  const out = path.join(__dirname, '..', 'assets', 'icon.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, image.toPNG());
  console.log('wrote', out);
  app.exit(0);
});
