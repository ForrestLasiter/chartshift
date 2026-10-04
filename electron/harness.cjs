// Test harness, only active when an environment variable asks for it:
//   CHARTSHIFT_SMOKE=<png path>  run the smoke checks and print a JSON report
//   CHARTSHIFT_SHOTS=<folder>    capture screenshots of the main screens
// Both drive the real app against throwaway folders (see main.cjs).
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs/promises');

// A 1x1 white PNG, for print tests.
const DOT_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Capturing the window occasionally fails for a moment (for example while the
// window is covered); a short retry is enough.
async function capture(win) {
  for (let attempt = 0; ; attempt++) {
    try { return (await win.webContents.capturePage()).toPNG(); } catch (error) {
      if (attempt >= 4) throw error;
      await sleep(400);
    }
  }
}

// Page-side code that builds a short WAV of strummed chords (G C D Em C G), for exercising
// "Chords from a recording" without a microphone.
const SYNTH_WAV = `(() => {
        const rate = 22050, voicings = { G: [43, 47, 50, 55, 59, 67], C: [48, 52, 55, 60, 64], D: [50, 57, 62, 66], Em: [40, 47, 52, 55, 59, 64] };
        const song = ['G', 'C', 'D', 'Em', 'C', 'G'], each = 2 * rate;
        const pcm = new Int16Array(song.length * each);
        song.forEach((name, n) => {
          for (const [k, midi] of voicings[name].entries()) {
            const hz = 440 * 2 ** ((midi - 69) / 12);
            for (let i = 0; i < each; i++) {
              const t = i / rate, since = (t % 0.5) - k * 0.012;
              if (since < 0) continue;
              let v = 0;
              for (let h = 1; h <= 5; h++) v += 0.6 ** (h - 1) * Math.sin(2 * Math.PI * hz * h * t);
              pcm[n * each + i] += 2200 * Math.exp(-since * 3) * v;
            }
          }
        });
        const bytes = new Uint8Array(44 + pcm.length * 2), view = new DataView(bytes.buffer);
        const tag = (at, text) => [...text].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
        tag(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true); tag(8, 'WAVEfmt '); view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
        view.setUint16(32, 2, true); view.setUint16(34, 16, true); tag(36, 'data'); view.setUint32(40, pcm.length * 2, true);
        new Int16Array(bytes.buffer, 44).set(pcm);
        return bytes;
      })()`;

function whenSampleOpens(win, run) {
  const fail = setTimeout(() => { console.error('HARNESS FAIL: sample did not open'); app.exit(1); }, 60000);
  let started = false;
  win.on('page-title-updated', async (_e, title) => {
    if (started || !title.startsWith('Sample chart')) return;
    started = true;
    clearTimeout(fail);
    try {
      await sleep(500);
      await run();
      app.exit(0);
    } catch (error) {
      console.error('HARNESS FAIL:', error);
      app.exit(1);
    }
  });
}

function runSmoke(win, { output, withPrintWindow, preload }) {
  whenSampleOpens(win, async () => {
    await fs.writeFile(output, await capture(win));
    const page = (code) => win.webContents.executeJavaScript(code);
    const report = await page(`(async () => { try {
      const lib = window.chartshift.library, rec = window.chartshift.recovery;
      const bytes = new Uint8Array([80, 75, 5, 6]), other = new Uint8Array([80, 75, 5, 6, 1]), third = new Uint8Array([80, 75, 5, 6, 2]);
      const out = { status: document.querySelector('[role=status]').textContent };

      // Library basics.
      const first = await lib.write('Smoke song', bytes);
      await lib.rename('Smoke song', 'Smoke song 2');
      await lib.saveSetlist('Smoke set', ['Smoke song 2']);
      const read = await lib.read('Smoke song 2');
      out.library = { readBack: read.data.length, sameVersion: read.version === first.version };

      // Sync conflicts: a stale editor must not overwrite a newer version.
      const mine = await lib.write('Shared', bytes);                                   // PC A saves
      const theirs = await lib.write('Shared', other, { expect: mine.version });       // PC B saves a newer one
      const stale = await lib.write('Shared', third, { expect: mine.version });        // PC A saves again, unaware
      const afterAsk = await lib.read('Shared');
      const replaced = await lib.write('Shared', third, { expect: mine.version, onConflict: 'replace' });
      const kept = await lib.read(replaced.kept[0]);
      const copy = await lib.write('Shared', bytes, { expect: mine.version, onConflict: 'copy' });
      const copy2 = await lib.write('Shared', other, { expect: mine.version, onConflict: 'copy' });
      const clash = await lib.write('Shared', bytes);                                  // a new song reusing the name
      out.conflict = {
        detected: stale.conflict && stale.conflict.reason,
        untouched: afterAsk.version === theirs.version,
        keptName: replaced.kept[0], keptIsTheirs: kept.version === theirs.version,
        copyName: copy.name, copyLeftOriginal: (await lib.read('Shared')).version === replaced.version,
        copiesDistinct: copy.name !== copy2.name && (await lib.read(copy.name)).version !== (await lib.read(copy2.name)).version,
        sameNameDetected: clash.conflict && clash.conflict.reason,
      };
      out.songs = (await lib.list()).songs.map((s) => s.name);

      // Recovery.
      await rec.save({ name: 'x', baseVersion: 'abc' }, bytes);
      const parked = await rec.load();
      await rec.clear();
      out.recovery = { name: parked && parked.meta.name, baseVersion: parked && parked.meta.baseVersion, cleared: (await rec.load()) === null };

      // Content security policy and protocol containment.
      out.csp = (await fetch('index.html')).headers.get('content-security-policy');
      try { new Function('return 1')(); out.evalBlocked = false; } catch { out.evalBlocked = true; }
      out.inlineScriptBlocked = await new Promise((resolve) => {
        window.__inline = false;
        const s = document.createElement('script');
        s.textContent = 'window.__inline = true';
        document.head.appendChild(s);
        setTimeout(() => resolve(window.__inline === false), 50);
      });
      const status = async (url) => { try { return (await fetch(url)).status; } catch { return 'blocked'; } };
      out.traversal = [await status('app://chartshift/..%2f..%2fpackage.json'), await status('app://chartshift/%2e%2e%5c%2e%2e%5cpackage.json'), await status('app://chartshift/..%2felectron%2fmain.cjs')];
      out.remoteFetch = await status('https://example.com/');
      out.popup = window.open('https://example.com/') === null;

      // Accessibility of the shell: names, menu, tabs and dialog focus.
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const named = (el) => (el.getAttribute('aria-label') || el.textContent || '').trim().length > 0;
      const labelled = (el) => !!(el.getAttribute('aria-label') || el.closest('label') || (el.id && document.querySelector('label[for="' + el.id + '"]')));
      const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      const a11y = {};
      a11y.unnamedButtons = [...document.querySelectorAll('button')].filter((el) => !named(el)).length;
      a11y.unlabelledFields = [...document.querySelectorAll('input, select, textarea')].filter((el) => !labelled(el)).length;
      a11y.headings = [...document.querySelectorAll('h1')].length;
      const more = document.querySelector('[aria-haspopup=menu]');
      more.click(); await sleep(100);
      const items = [...document.querySelectorAll('[role=menuitem]')];
      a11y.menuFocusesFirstItem = document.activeElement === items.find((i) => !i.disabled);
      key(document.activeElement, 'ArrowDown');
      a11y.menuArrowMoves = document.activeElement === items.filter((i) => !i.disabled)[1];
      key(document.activeElement, 'Escape'); await sleep(100);
      a11y.menuEscapeCloses = !document.querySelector('[role=menu]') && document.activeElement === more && more.getAttribute('aria-expanded') === 'false';
      const tabs = [...document.querySelectorAll('.inspector [role=tab]')];
      const at = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
      tabs[at].focus(); key(tabs[at], 'ArrowRight'); await sleep(100);
      const now = [...document.querySelectorAll('.inspector [role=tab]')];
      const next = now[(at + 1) % now.length];
      a11y.tabsArrow = next.getAttribute('aria-selected') === 'true' && document.activeElement === next && now[at].tabIndex === -1
        && now.filter((t) => t.tabIndex === 0).length === 1 && !!document.getElementById(next.getAttribute('aria-controls'));
      const opener = [...document.querySelectorAll('.file-actions button')].find((b) => b.textContent.trim() === 'Library');
      opener.focus(); opener.click(); await sleep(400);
      const dialog = document.querySelector('dialog[open]');
      a11y.dialogModal = !!dialog && dialog.matches(':modal') && dialog.contains(document.activeElement) && !!document.getElementById(dialog.getAttribute('aria-labelledby'));
      a11y.dialogUnnamed = dialog ? [...dialog.querySelectorAll('button')].filter((el) => !named(el)).length + [...dialog.querySelectorAll('input, select')].filter((el) => !labelled(el)).length : -1;
      dialog.dispatchEvent(new Event('cancel', { cancelable: true })); await sleep(300);
      a11y.dialogClosesAndRestoresFocus = !document.querySelector('dialog[open]') && document.activeElement === opener;
      out.a11y = a11y;

      // Sections from the sample's "[Verse 1]" style headings.
      const press = (name, scope = document) => [...scope.querySelectorAll('button, [role=tab]')].find((el) => (el.getAttribute('aria-label') || el.textContent.trim()) === name).click();
      press('Sections'); await sleep(150);
      press('Find sections from headings'); await sleep(150);
      out.sections = [__editor.sectionList(0).map((s) => s.label), __editor.sectionList(1).map((s) => s.label)];

      // Two pages fit next to each other.
      press('Two pages side by side'); await sleep(400);
      const sheets = () => [...document.querySelectorAll('.sheet canvas')];
      const [left, right] = sheets().map((c) => c.getBoundingClientRect());
      out.sideBySide = Math.abs(left.top - right.top) < 2 && right.left > left.right && right.right <= document.getElementById('workspace').getBoundingClientRect().right;

      // Dragging a line from page 1 and dropping it on page 2 moves it there.
      __editor.set({ level: 'line', tool: 'select' });
      __editor.select([]);
      const zoom = __editor.getState().zoom;
      const grab = __editor.getState().pages[0].pieces.find((q) => q.y > 170 && q.y < 182);
      const lineIds = __editor.getState().pages[0].pieces.filter((q) => q.line === grab.line).map((q) => q.id);
      const fire = (type, x, y) => sheets()[0].dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1 }));
      const from = sheets()[0].getBoundingClientRect(), to = sheets()[1].getBoundingClientRect();
      const startX = from.left + (grab.x + grab.w / 2) * zoom, startY = from.top + (grab.y + grab.h / 2) * zoom;
      const dropX = to.left + 300 * zoom, dropY = to.top + 400 * zoom;
      fire('pointerdown', startX, startY);
      fire('pointermove', startX + 10, startY + 10);
      fire('pointermove', dropX, dropY);
      const preview = __editor.transient.cross;
      fire('pointerup', dropX, dropY);
      const after = __editor.getState();
      const landed = after.pages[1].pieces.find((q) => q.id === grab.id);
      out.dragAcrossPages = {
        previewed: !!preview && preview.from === 0 && preview.to === 1,
        leftPageOne: lineIds.every((id) => !after.pages[0].pieces.some((q) => q.id === id)),
        arrivedOnPageTwo: lineIds.every((id) => after.pages[1].pieces.some((q) => q.id === id)),
        underPointer: !!landed && Math.abs(landed.x + landed.w / 2 - 300) < 1 && Math.abs(landed.y + landed.h / 2 - 400) < 1,
        status: after.status,
      };
      __editor.undo();
      out.dragUndone = lineIds.every((id) => __editor.getState().pages[0].pieces.some((q) => q.id === id));

      // Print preview: one sheet per page, actually drawn, and it follows the paper choice.
      const inked = (canvas) => {
        const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < data.length; i += 4) if (data[i] < 128) return true;
        return false;
      };
      const previewCanvases = () => [...document.querySelectorAll('.sheet-preview canvas')];
      const aspect = (c) => (c.width > c.height ? 'landscape' : 'portrait');
      const preview1 = {};
      press('Print'); await sleep(500);
      preview1.title = document.querySelector('dialog[open] h2').textContent;
      preview1.sheets = previewCanvases().length;
      preview1.drawn = previewCanvases().every(inked);
      preview1.captions = previewCanvases().map((c) => c.getAttribute('aria-label'));
      preview1.unnamed = [...document.querySelectorAll('dialog[open] button')].filter((el) => !named(el)).length + [...document.querySelectorAll('dialog[open] input, dialog[open] select')].filter((el) => !labelled(el)).length;
      preview1.ownSizeChosen = document.querySelector('dialog[open] input[type=radio]').checked;
      press('Cancel', document.querySelector('dialog[open]')); await sleep(300);
      // With one landscape page the preview offers one paper size, and switching shows the difference.
      const both = __editor.getState().pages;
      __editor.commit([both[0], { ...both[1], w: 792, h: 612 }], { status: 'page 2 landscape' });
      press('Print'); await sleep(500);
      const radios = [...document.querySelectorAll('dialog[open] input[type=radio]')];
      preview1.mixedDefaultsToOnePaper = radios[1].checked;
      preview1.fitted = previewCanvases().map(aspect);
      preview1.fittedCaption = previewCanvases()[1].getAttribute('aria-label');
      radios[0].click(); await sleep(300);
      preview1.ownSize = previewCanvases().map(aspect);
      preview1.stillDrawn = previewCanvases().every(inked);
      press('Cancel', document.querySelector('dialog[open]')); await sleep(300);
      preview1.closed = !document.querySelector('dialog[open]');
      __editor.undo();
      out.printPreview = preview1;

      // Songwriting: start a new song, type it, and use the writing tools.
      window.confirm = () => true; // "discard changes?" would otherwise wait for a person
      const setValue = (el, value) => {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
        el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
      };
      const S = () => __editor.getState();
      const pageText = () => S().pages.flatMap((pg) => pg.pieces.filter((q) => q.kind === 'text').sort((x, y) => x.y - y.y || x.x - y.x).map((q) => q.text));
      const w = {};
      press('New'); await sleep(300);
      w.dialog = document.querySelector('dialog[open] h2').textContent;
      setValue(document.querySelector('dialog[open] input[type=text]'), 'Morning Song');
      await sleep(50);
      document.querySelector('dialog[open] form').requestSubmit(); await sleep(400);
      w.tab = document.querySelector('.inspector [role=tab][aria-selected=true]').textContent.trim();
      w.name = S().name;
      w.blankPage = pageText();
      const area = document.querySelector('.write-box textarea');
      setValue(area, 'Verse 1\\n[G]Morning light is [C]on the hills\\n[Em]Every shadow [D]fades\\n\\nChorus\\n[C]Lift it [G]up, let it ring'); await sleep(200);
      w.pageAfterTyping = pageText();
      w.chordPieces = S().pages[0].pieces.filter((q) => q.chord).map((q) => q.text);
      w.sectionsOnPage = __editor.sectionList(0).map((x) => x.label);
      w.syllables = [...document.querySelectorAll('.syllables span')].map((x) => x.textContent);
      w.palette = [...document.querySelectorAll('.palette button')].map((x) => x.textContent);
      // A palette button puts its chord in at the cursor.
      area.focus(); area.setSelectionRange(area.value.length, area.value.length);
      document.querySelectorAll('.palette button')[4].click(); await sleep(200);
      w.inserted = S().write.text.endsWith('[D]');
      // Chord diagrams.
      setValue([...document.querySelectorAll('.inspector select')].find((x) => [...x.options].some((o) => o.textContent === 'Ukulele')), 'guitar'); await sleep(200);
      w.diagrams = S().pages[0].pieces.filter((q) => q.kind === 'diagram').map((q) => q.chord);
      // Drafts.
      [...document.querySelectorAll('details.more summary')].find((x) => x.textContent.startsWith('Drafts')).click(); await sleep(100);
      document.querySelector('.inspector form').requestSubmit(); await sleep(150);
      w.draftSaved = S().write.drafts.map((d) => d.name);
      // Transposing a written song rewrites its text and its key.
      __editor.transpose(2); await sleep(100);
      w.transposed = [S().write.text.split('\\n')[1], S().write.meta.key];
      __editor.restoreDraft(0); await sleep(100);
      w.restored = [S().write.text.split('\\n')[1], S().write.meta.key, S().write.drafts.map((d) => d.name)];
      // Structure: move the chorus before the verse.
      press('Sections'); await sleep(150);
      w.structure = [...document.querySelectorAll('.section-row strong')].map((x) => x.textContent);
      press('Move Chorus earlier'); await sleep(150);
      w.reordered = S().write.text.split('\\n')[0] + ' / ' + __editor.sectionList(0).map((x) => x.label).join(',');
      // Save, reopen from the library, and the song is still a written song.
      press('Save'); await sleep(300);
      document.querySelector('dialog[open] form').requestSubmit(); await sleep(1200);
      w.savedAs = S().savedAs;
      const textBefore = S().write.text;
      press('Library'); await sleep(400);
      press('Open Morning Song', document.querySelector('dialog[open]')); await sleep(1500);
      w.reopened = { write: !!S().write, sameText: S().write && S().write.text === textBefore, title: S().write && S().write.meta.title, drafts: S().write && S().write.drafts.length, diagrams: S().write && S().write.diagrams, tab: document.querySelector('.inspector [role=tab][aria-selected=true]').textContent.trim(), diagramPieces: S().pages[0].pieces.filter((q) => q.kind === 'diagram').length };
      w.unnamed = [...document.querySelectorAll('button')].filter((el) => !named(el)).length + [...document.querySelectorAll('input, select, textarea')].filter((el) => !labelled(el)).length;
      await window.chartshift.library.remove('Morning Song').catch(() => {});
      out.writing = w;

      // Chords from a recording: a synthesised strummed G C D Em as a WAV file.
      const wav = ${SYNTH_WAV};
      window.__testAudio = wav;
      const l = {};
      more.click(); await sleep(150);
      [...document.querySelectorAll('[role=menuitem]')].find((x) => x.textContent.includes('Chords from a recording')).click(); await sleep(300);
      l.title = document.querySelector('dialog[open] h2').textContent;
      l.startUnnamed = [...document.querySelectorAll('dialog[open] button')].filter((el) => !named(el)).length;
      press('Choose an audio file…', document.querySelector('dialog[open]'));
      for (let i = 0; i < 100 && !document.querySelector('.chord-timeline, dialog[open] .error'); i++) await sleep(200);
      l.error = document.querySelector('dialog[open] .error')?.textContent || null;
      l.chips = [...document.querySelectorAll('.chord-chip strong')].map((x) => x.textContent);
      l.times = [...document.querySelectorAll('.chord-chip span')].map((x) => x.textContent);
      l.summary = document.querySelector('dialog[open] .fact')?.textContent;
      l.text = document.querySelector('.listen-text')?.value;
      l.hasPlayer = !!document.querySelector('dialog[open] audio[src^="blob:"]');
      l.resultUnnamed = [...document.querySelectorAll('dialog[open] button')].filter((el) => !named(el)).length + [...document.querySelectorAll('dialog[open] select, dialog[open] textarea')].filter((el) => !labelled(el)).length;
      l.canAppend = !![...document.querySelectorAll('dialog[open] button')].find((x) => x.textContent === 'Add to the end of this song');
      press('Add to the end of this song', document.querySelector('dialog[open]')); await sleep(300);
      l.appended = S().write.text.trimEnd().endsWith('[G] [C] [D] [Em]\\n[C] [G]');
      l.onPage = S().pages.flatMap((pg) => pg.pieces.filter((q) => q.chord && q.kind === 'text').map((q) => q.text)).slice(-6);
      l.closed = !document.querySelector('dialog[open]');
      // Microphone: only sound, only for this page; the camera stays refused.
      const ask = async (constraints) => { try { const stream = await navigator.mediaDevices.getUserMedia(constraints); stream.getTracks().forEach((t) => t.stop()); return 'granted'; } catch (e) { return e.name; } };
      l.camera = await ask({ video: true });
      l.microphone = await ask({ audio: true });
      out.listening = l;
      return out;
    } catch (error) { return { pageError: String(error && error.stack || error) }; } })()`);
    if (report.pageError) throw new Error('in-page checks failed: ' + report.pageError);

    // Navigation away from the app is refused.
    await page(`location.href = 'https://example.com/'; 0`).catch(() => {});
    await sleep(400);
    report.urlAfterNavigation = win.webContents.getURL();

    // A second window showing the same page gets no privileged access.
    const other = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true } });
    await other.loadURL('app://chartshift/index.html');
    report.otherWindow = await other.webContents.executeJavaScript(`window.chartshift.library.list().then(() => 'allowed', () => 'refused')`);
    other.destroy();

    // Mixed page sizes really come out as differently sized sheets.
    const sheets = [[8.5, 11], [11, 8.5], [5.833, 8.264], [8.5, 11]].map(([widthIn, heightIn]) => ({ png: DOT_PNG, widthIn, heightIn }));
    const pdf = await withPrintWindow(sheets, (printWin) => printWin.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true }));
    report.mixedPrint = [...pdf.toString('latin1').matchAll(/\/MediaBox\s*\[\s*([\d.\s-]+)\]/g)].map((m) => m[1].trim().split(/\s+/).slice(2).map((n) => Math.round(Number(n))).join('x'));

    // OCR must still work under the content security policy.
    if (process.env.CHARTSHIFT_SMOKE_OCR) {
      await win.loadURL('app://chartshift/index.html?sample&ocr');
      const deadline = Date.now() + 90000;
      while (Date.now() < deadline) {
        await sleep(500);
        const status = await page(`document.querySelector('[role=status]').textContent`);
        if (/^Found \d+ chords/.test(status) || /could not open|wrong|failed/i.test(status)) { report.ocr = status; break; }
      }
    }
    console.log('SMOKE REPORT:' + JSON.stringify(report));
  });
}

// Helpers injected into the page for the screenshot scenes.
const PAGE_HELPERS = `
  window.__h = {
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    idle: async () => { for (let i = 0; i < 400 && document.querySelector('.busy'); i++) await __h.sleep(50); await __h.sleep(120); },
    // Finds a button, tab or radio by its visible text or accessible name.
    find: (name, scope = document) => [...scope.querySelectorAll('button, [role=tab], [role=menuitem], summary')].find((el) =>
      (el.getAttribute('aria-label') || '') === name || el.textContent.trim() === name
      || (el.getAttribute('aria-label') || '').startsWith(name) || el.textContent.trim().startsWith(name)),
    press: async (name, scope) => { const el = __h.find(name, scope); if (!el) throw new Error('no control named ' + name); el.click(); await __h.sleep(250); },
    type: (el, value) => {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    },
    // Pointer events at a position given in page points on page N.
    pointer: (pageIndex, type, x, y) => {
      const canvas = document.querySelectorAll('.sheet canvas')[pageIndex];
      const r = canvas.getBoundingClientRect(), z = __editor.getState().zoom;
      canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: r.left + x * z, clientY: r.top + y * z, button: 0, pointerId: 1 }));
    },
    click: (pageIndex, x, y) => { __h.pointer(pageIndex, 'pointerdown', x, y); __h.pointer(pageIndex, 'pointerup', x, y); },
    closeDialog: async () => { const d = document.querySelector('dialog[open]'); if (d) { d.dispatchEvent(new Event('cancel', { cancelable: true })); await __h.sleep(250); } },
  };
`;

// Each scene sets something up; a screenshot is taken after it.
const SCENES = [
  ['01-sample', `await __h.press('Fit'); document.querySelector('.workspace').scrollTop = 0;`],
  ['02-selection', `
    __editor.set({ level: 'line', tool: 'select' });
    const p = __editor.getState().pages[0].pieces.find((q) => q.y > 170 && q.y < 182);
    __h.click(0, p.x + p.w / 2, p.y + p.h / 2);`],
  ['03-text-editing', `
    __editor.select([]);
    await __h.press('Text box');
    __h.pointer(0, 'pointerdown', 330, 120);
    await __h.sleep(200);
    __h.type(document.querySelector('textarea.text-editor'), 'Capo 2 - repeat chorus twice');`],
  ['04-chords', `
    document.activeElement && document.activeElement.blur();
    await __h.sleep(150);
    await __h.press('Move');
    __editor.select([]);
    __editor.autoSections();
    const tab = __h.find('Chords'); if (tab) tab.click();`],
  ['04b-sections', `await __h.press('Sections');`],
  ['04c-page-and-menu', `await __h.press('Page'); await __h.press('More file actions');`],
  ['05-library', `
    await __h.press('More file actions');
    await __h.press('Sections');
    await __h.press('Library');
    await __h.sleep(400);`],
  ['05b-setlists', `await __h.press('Setlists');`],
  ['06-library-folder', `await __h.press('Folder and sync');`],
  ['07-print-preview', `
    await __h.closeDialog();
    const pages = __editor.getState().pages;
    __editor.commit([pages[0], { ...pages[1], w: 792, h: 612 }], { status: 'Page 2 turned to landscape (screenshot set-up).' });
    await __h.press('Print');
    await __h.sleep(400);`],
  ['07b-print-preview-own-size', `
    document.querySelector('dialog[open] input[type=radio]').click();
    await __h.press('Larger preview');
    await __h.sleep(300);`],
  ['08-save-name', `
    await __h.closeDialog();
    __editor.undo();
    await __h.press('Save');
    await __h.sleep(200);`],
  ['09-conflict', `
    __h.type(document.querySelector('dialog input'), 'Morning Light');
    document.querySelector('dialog form').requestSubmit();
    await __h.sleep(400); await __h.idle();
    await window.chartshift.library.write('Morning Light', new Uint8Array([80, 75, 5, 6, 9]), { expect: __editor.getState().baseVersion });
    __editor.selectAll(); __editor.moveSelection(0, 2); __editor.select([]);
    await __h.press('Save');
    await __h.idle();`],
  ['10-two-pages', `
    await __h.closeDialog();
    __editor.select([]);
    await __h.press('Two pages side by side');
    document.querySelector('.workspace').scrollTop = 0;`],
  ['11-drag-to-other-page', `
    __editor.set({ level: 'section', tool: 'select' });
    const z = __editor.getState().zoom;
    const g = __editor.getState().pages[0].pieces.find((q) => q.y > 280 && q.y < 300);
    const sheets = [...document.querySelectorAll('.sheet canvas')];
    const a = sheets[0].getBoundingClientRect(), b = sheets[1].getBoundingClientRect();
    const fire = (type, x, y) => sheets[0].dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1 }));
    const sx = a.left + (g.x + g.w / 2) * z, sy = a.top + (g.y + g.h / 2) * z;
    fire('pointerdown', sx, sy); fire('pointermove', sx + 8, sy + 8); fire('pointermove', b.left + 150 * z, b.top + 420 * z);
    window.__drop = () => fire('pointerup', b.left + 150 * z, b.top + 420 * z);
    await __h.sleep(200);`],
  ['12-after-drop', `window.__drop(); await __h.sleep(200);`],
  ['13-new-song-dialog', `
    await __h.closeDialog();
    window.confirm = () => true;
    await __h.press('New');`],
  ['14-write-tab', `
    __h.type(document.querySelector('dialog[open] input[type=text]'), 'Morning Song');
    document.querySelector('dialog[open] form').requestSubmit();
    await __h.sleep(400);
    __h.type(document.querySelector('.write-box textarea'), 'Verse 1\\n[G]Morning light is [C]on the hills again\\n[Em]Every shadow [C]starts to fade a[D]way\\n\\nChorus\\n[C]Lift it [G]up, lift it [D]up, let it [Em]ring\\n[C]All to[G]gether [D]now we [G]sing\\n\\nVerse 2\\n[G]Evening comes and [C]still the song re[G]mains');
    __h.type([...document.querySelectorAll('.inspector select')].find((x) => [...x.options].some((o) => o.textContent === 'Ukulele')), 'guitar');
    await __h.press('Fit');
    await __h.sleep(300);`],
  ['15-write-structure', `await __h.press('Sections');`],
  ['16-write-chords', `await __h.press('Chords');`],
  ['17-back-to-sample', `
    document.querySelector('.inspector [role=tab]').click();
    await __h.sleep(100);`],
  ['18-listen-start', `
    await __h.press('More file actions');
    [...document.querySelectorAll('[role=menuitem]')].find((x) => x.textContent.includes('Chords from a recording')).click();
    await __h.sleep(300);`],
  ['19-listen-result', `
    window.__testAudio = ${SYNTH_WAV};
    await __h.press('Choose an audio file…', document.querySelector('dialog[open]'));
    for (let i = 0; i < 100 && !document.querySelector('.chord-timeline'); i++) await __h.sleep(200);
    const audio = document.querySelector('dialog[open] audio');
    audio.currentTime = 4.5;
    await __h.sleep(400);`],
];

function runShots(win, { folder }) {
  const sizes = [[1280, 800, 1], [1440, 900, 1], [900, 600, 1], [1280, 800, 1.25], [1280, 800, 1.5]];
  whenSampleOpens(win, async () => {
    const page = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
    const failures = [];
    // A library with some believable songs, so lists are not empty.
    await page(`
      const lib = window.chartshift.library, blank = new Uint8Array([80, 75, 5, 6]);
      for (const name of ['Amazing Grace', 'Be Thou My Vision', 'Come Thou Fount', 'Great Is Thy Faithfulness', 'How Great Thou Art', 'It Is Well With My Soul (key of C, capo 2, long title to check wrapping)']) await lib.write(name, blank);
      await lib.saveSetlist('Sunday 12 October', ['Amazing Grace', 'How Great Thou Art', 'Come Thou Fount']);
      await lib.saveSetlist('Wednesday rehearsal', ['Be Thou My Vision']);`);
    for (const [width, height, zoom] of sizes) {
      const dir = path.join(folder, `${width}x${height}${zoom === 1 ? '' : `@${Math.round(zoom * 100)}`}`);
      await fs.mkdir(dir, { recursive: true });
      win.setContentSize(width, height);
      win.webContents.setZoomFactor(zoom);
      const shoot = async (name) => { await sleep(350); await fs.writeFile(path.join(dir, `${name}.png`), await capture(win)); };
      await win.loadURL('app://chartshift/index.html?debug');
      await sleep(900);
      await shoot('00-welcome');
      const opened = new Promise((resolve) => win.once('page-title-updated', resolve));
      await win.loadURL('app://chartshift/index.html?sample&debug');
      await opened;
      await sleep(700);
      await page(PAGE_HELPERS);
      for (const [name, code] of SCENES) {
        try {
          await page(`await __h.idle(); ${code} await __h.idle();`);
          await shoot(name);
        } catch (error) {
          failures.push(`${path.basename(dir)}/${name}: ${String(error.message).split('\n')[0]}`);
        }
      }
      await page(`await __h.closeDialog(); await window.chartshift.library.remove('Morning Light').catch(() => {});`).catch(() => {});
    }
    console.log('SHOTS REPORT:' + JSON.stringify({ folder, failures }));
  });
}

module.exports = { runSmoke, runShots };
