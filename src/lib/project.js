// .chartshift song files: a zip holding song.json plus the sprite atlases,
// so a song stays fully editable and is a single file to copy or sync.
import JSZip from 'jszip';

const FORMAT = 'chartshift-song';
const VERSION = 1;

// Atlases never change after import, so each is encoded once; this keeps
// repeat saves and autosaves quick.
const encoded = new WeakMap();
const canvasToBlob = (canvas) => {
  if (!encoded.has(canvas)) encoded.set(canvas, new Promise((resolve) => canvas.toBlob(resolve, 'image/png')));
  return encoded.get(canvas);
};

export async function saveProject({ pages, atlases, ids }) {
  const zip = new JSZip();
  // Only keep atlases that some piece still uses.
  const used = new Set();
  for (const page of pages) for (const p of page.pieces) if (p.kind === 'clip') used.add(p.atlas);
  zip.file('song.json', JSON.stringify({ format: FORMAT, version: VERSION, ids, atlasCount: atlases.length, pages }));
  for (let i = 0; i < atlases.length; i++) {
    if (used.has(i)) zip.file(`atlas-${i}.png`, await canvasToBlob(atlases[i]), { compression: 'STORE' });
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function loadProject(data) {
  const zip = await JSZip.loadAsync(data);
  const entry = zip.file('song.json');
  if (!entry) throw new Error('This file is not a ChartShift song.');
  const song = JSON.parse(await entry.async('string'));
  if (song.format !== FORMAT) throw new Error('This file is not a ChartShift song.');
  if (song.version > VERSION) throw new Error('This song was saved by a newer version of ChartShift.');
  const atlases = [];
  for (let i = 0; i < song.atlasCount; i++) {
    const canvas = document.createElement('canvas');
    const file = zip.file(`atlas-${i}.png`);
    if (file) {
      const bitmap = await createImageBitmap(await file.async('blob'));
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      bitmap.close();
    } else {
      canvas.width = canvas.height = 1;
    }
    atlases.push(canvas);
  }
  return { pages: song.pages, atlases, ids: song.ids };
}
