// .chartshift song files: a zip holding song.json plus the sprite atlases,
// so a song stays fully editable and is a single file to copy or sync.
import JSZip from 'jszip';
import { LIMITS, VERSION, checkAtlasPng, checkSongEntries, validateSong } from './songSchema.js';

const FORMAT = 'chartshift-song';

// Atlases never change after import, so each is encoded once; this keeps
// repeat saves and autosaves quick.
const encoded = new WeakMap();
const canvasToBlob = (canvas) => {
  if (!encoded.has(canvas)) encoded.set(canvas, new Promise((resolve) => canvas.toBlob(resolve, 'image/png')));
  return encoded.get(canvas);
};

export async function saveProject({ pages, atlases, ids, write = null }) {
  const zip = new JSZip();
  // Only keep atlases that some piece still uses.
  const used = new Set();
  for (const page of pages) for (const p of page.pieces) if (p.kind === 'clip') used.add(p.atlas);
  zip.file('song.json', JSON.stringify({ format: FORMAT, version: VERSION, ids, atlasCount: atlases.length, pages, ...(write ? { write } : null) }));
  for (let i = 0; i < atlases.length; i++) {
    if (!used.has(i)) continue;
    const blob = await canvasToBlob(atlases[i]);
    if (!blob) throw new Error('A page picture could not be saved.');
    zip.file(`atlas-${i}.png`, blob, { compression: 'STORE' });
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/**
 * Opens a song file. The file is treated as untrusted: sizes are checked
 * before anything is unpacked, the contents are validated, and every failure
 * surfaces as an Error with a message fit to show the user.
 */
export async function loadProject(data) {
  if (data.byteLength > LIMITS.fileBytes) throw new Error('This song file is too large to open.');
  let zip;
  try { zip = await JSZip.loadAsync(data); } catch { throw new Error('This file is not a ChartShift song, or it is damaged.'); }
  const files = Object.values(zip.files).filter((f) => !f.dir);
  checkSongEntries(files.map((f) => ({ name: f.name, size: f._data?.uncompressedSize ?? 0 })));
  const entry = zip.file('song.json');
  if (!entry) throw new Error('This file is not a ChartShift song.');
  const text = await entry.async('string');
  if (text.length > LIMITS.jsonBytes) throw new Error('This song file is too large to open.');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('This song file is damaged and cannot be opened.'); }
  const song = validateSong(parsed);

  const used = new Set();
  for (const page of song.pages) for (const p of page.pieces) if (p.kind === 'clip') used.add(p.atlas);
  const atlases = [];
  for (let i = 0; i < song.atlasCount; i++) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const file = used.has(i) ? zip.file(`atlas-${i}.png`) : null;
    if (used.has(i) && !file) throw new Error('This song file is missing one of its pictures.');
    if (file) {
      const bytes = await file.async('uint8array');
      // The sizes listed in a zip can lie, and so can a tiny PNG that claims
      // to be enormous: check the real bytes and the declared dimensions
      // before asking the browser to decode anything.
      if (bytes.length > LIMITS.atlasBytes) throw new Error('This song file contains an item that is too large.');
      checkAtlasPng(bytes);
      let bitmap;
      try { bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' })); } catch { throw new Error('A picture inside this song is damaged.'); }
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      bitmap.close();
    }
    atlases.push(canvas);
  }
  // A piece may only show a part of its picture that actually exists.
  for (const page of song.pages) {
    for (const p of page.pieces) {
      if (p.kind !== 'clip') continue;
      const atlas = atlases[p.atlas];
      if (p.sx + p.sw > atlas.width || p.sy + p.sh > atlas.height) throw new Error('This song file is damaged: a piece points outside its picture.');
    }
  }
  return { pages: song.pages, atlases, ids: song.ids, write: song.write };
}
