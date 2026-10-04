// Renders the pages of a PDF to PNG files, for looking at what a PDF really
// contains. Usage: npx electron scripts/render-pdf.cjs "<file.pdf>" <out-folder> [dpi]
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const [file, outDir, dpi = '110'] = process.argv.slice(2);
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const htmlPath = path.join(app.getPath('temp'), `chartshift-render-${process.pid}.html`);
    const lib = pathToFileURL(path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'build')).toString();
    fs.writeFileSync(htmlPath, `<!doctype html><meta charset="utf-8"><script type="module">
      import * as pdfjs from '${lib}/pdf.mjs';
      pdfjs.GlobalWorkerOptions.workerSrc = '${lib}/pdf.worker.mjs';
      window.renderAll = async (bytes, scale) => {
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
        const out = [];
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvas, canvasContext: ctx, viewport, intent: 'print' }).promise;
          out.push(canvas.toDataURL('image/png'));
        }
        return out;
      };
      window.ready = true;
    </script>`);
    const win = new BrowserWindow({ show: false, webPreferences: { webSecurity: false } });
    await win.loadFile(htmlPath);
    for (let i = 0; i < 100 && !(await win.webContents.executeJavaScript('window.ready === true')); i++) await new Promise((r) => setTimeout(r, 100));
    const bytes = Array.from(fs.readFileSync(file));
    const pages = await win.webContents.executeJavaScript(`renderAll(${JSON.stringify(bytes)}, ${Number(dpi) / 72})`);
    pages.forEach((url, i) => fs.writeFileSync(path.join(outDir, `page-${i + 1}.png`), Buffer.from(url.split(',')[1], 'base64')));
    fs.rmSync(htmlPath, { force: true });
    console.log(`wrote ${pages.length} page(s) to ${outDir}`);
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
