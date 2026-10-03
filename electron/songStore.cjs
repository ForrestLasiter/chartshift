// File operations for the library folder, written so that no version of a
// song is ever destroyed without having been seen or kept. No Electron
// imports: everything here runs (and is tested) under plain Node.
//
// The guarantee, precisely: ON THIS PC, a save never removes a file's contents
// unless they are exactly the version the editor last read or wrote. Anything
// else found in the way - including a version that appears while the save is
// in progress - is kept under a new, unique name. What this cannot cover: a
// sync service (OneDrive, Google Drive, Dropbox…) copies files between PCs
// some time later, with no shared lock or compare-and-swap. If two PCs save
// the same song before they have synced, each PC's save is locally correct and
// the sync service decides what happens next (normally it keeps both, naming
// one a "conflicted copy").
const fsp = require('fs/promises');
const { constants } = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SONG_EXT, SETLIST_EXT, LIMITS, safeName, decideWrite, copyName } = require('./safety.cjs');

// A file's version is a hash of its bytes: unlike a timestamp it cannot be
// fooled by a sync app touching the file, and it matches across PCs.
const versionOf = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

const isLibraryFile = (file) => file.endsWith(SONG_EXT) || file.endsWith(SETLIST_EXT);
const extOf = (file) => (file.endsWith(SONG_EXT) ? SONG_EXT : SETLIST_EXT);

let sequence = 0;
// Working files end in .tmp, so the library never lists them as songs.
const tempName = (target, tag) => `${target}.${tag}.${process.pid}.${Date.now()}.${sequence++}.tmp`;

async function readIfExists(file) {
  try { return await fsp.readFile(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

/**
 * Moves `temp` to `target` only if nothing is there. Returns false (leaving
 * `temp` in place) when `target` already exists. A hard link is used because,
 * unlike a rename, it fails rather than overwrites - and the file appears
 * complete, never half-written.
 */
async function placeExclusive(temp, target) {
  try {
    await fsp.link(temp, target);
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    // No hard links here (some network or FAT drives): fall back to an exclusive copy.
    try {
      await fsp.copyFile(temp, target, constants.COPYFILE_EXCL);
    } catch (copyError) {
      if (copyError.code === 'EEXIST') return false;
      throw copyError;
    }
  }
  await fsp.rm(temp, { force: true });
  return true;
}

/** Writes a new file; false if the name is taken. Never overwrites. */
async function writeNew(target, buffer) {
  const temp = tempName(target, 'new');
  await fsp.writeFile(temp, buffer);
  try { return await placeExclusive(temp, target); } finally { await fsp.rm(temp, { force: true }); }
}

/** Overwrites `target` in one step (for files where the last save should win). */
async function writeAtomic(target, buffer) {
  const temp = tempName(target, 'new');
  try {
    await fsp.writeFile(temp, buffer);
    await fsp.rename(temp, target);
  } finally {
    await fsp.rm(temp, { force: true });
  }
}

/**
 * Stores content under a name of the form "Name (label date time)" that is
 * guaranteed not to exist yet: the timestamp only has one-second precision, so
 * a counter is added until an exclusive create succeeds. `source` is either
 * { buffer } or { fromPath } (an existing working file, which is consumed).
 * Returns the name used (without extension).
 */
async function placeUnique(dir, name, ext, label, date, source) {
  const temp = source.fromPath || tempName(path.join(dir, safeName(name) + ext), 'new');
  if (!source.fromPath) await fsp.writeFile(temp, source.buffer);
  try {
    for (let n = 1; n <= 10000; n++) {
      const candidate = copyName(name, label, date, n);
      if (await placeExclusive(temp, path.join(dir, candidate + ext))) return candidate;
    }
    throw new Error('Could not find a free name for a copy.');
  } finally {
    if (!source.fromPath) await fsp.rm(temp, { force: true });
  }
}

/** Renames a file, refusing (false) rather than overwriting if the new name is taken. */
async function renameExclusive(from, to) {
  try {
    await fsp.link(from, to);
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    if (await readIfExists(to)) return false;
    await fsp.rename(from, to);
    return true;
  }
  await fsp.rm(from);
  return true;
}

/**
 * Saves a song into `dir`.
 * options.expect     – version the editor last read or wrote (null for a new name)
 * options.onConflict – 'ask' (default): write nothing and report the conflict
 *                      'replace': keep the other version, then write this one
 *                      'copy': leave the other version alone, save under a new name
 * env.trash(path)    – sends a file to the Recycle Bin
 * env.now()          – current Date (injectable for tests)
 * env.hooks          – test hooks: afterCheck(), beforePlace(attempt)
 *
 * Returns { conflict } | { name, version, kept, savedAsCopy? } where `kept`
 * lists the names under which other versions were preserved.
 */
async function writeSong(dir, name, data, { expect = null, onConflict = 'ask' } = {}, env = {}) {
  const now = env.now || (() => new Date());
  const hooks = env.hooks || {};
  const buffer = Buffer.from(data);
  if (buffer.length > LIMITS.songBytes) throw new Error('This song is too large to save.');
  const clean = safeName(name);
  const target = path.join(dir, clean + SONG_EXT);
  const version = versionOf(buffer);

  const existing = await readIfExists(target);
  const seen = existing && versionOf(existing);
  const verdict = decideWrite({ current: seen, expect });
  if (hooks.afterCheck) await hooks.afterCheck();

  if (verdict !== 'write') {
    if (onConflict === 'copy') {
      return { name: await placeUnique(dir, clean, SONG_EXT, 'my copy', now(), { buffer }), version, savedAsCopy: true, kept: null };
    }
    if (onConflict !== 'replace') {
      return { conflict: { reason: verdict, name: clean, modified: (await fsp.stat(target)).mtimeMs } };
    }
    // Replacing a *different* song that merely has this name: the user was told
    // it goes to the Recycle Bin, where it can be restored.
    if (verdict === 'exists') {
      if (!env.trash) throw new Error('Cannot replace: the Recycle Bin is not available.');
      try { await env.trash(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }

  // The only contents that may be dropped are the exact version the editor has
  // already seen. Everything else found in the way is kept.
  const disposable = verdict === 'write' ? seen : null;
  const kept = [];
  const temp = tempName(target, 'new');
  await fsp.writeFile(temp, buffer);
  try {
    for (let attempt = 0; attempt < 6; attempt++) {
      if (hooks.beforePlace) await hooks.beforePlace(attempt);
      if (await placeExclusive(temp, target)) return { name: clean, version, kept: kept.length ? kept : null };
      // Something is there. Moving it aside cannot destroy it, whatever it is -
      // even a version that arrived after the check above.
      const aside = tempName(target, 'old');
      try {
        await fsp.rename(target, aside);
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      const old = await fsp.readFile(aside);
      if (disposable && versionOf(old) === disposable) await fsp.rm(aside);
      else kept.push(await placeUnique(dir, clean, SONG_EXT, 'conflict copy', now(), { fromPath: aside }));
    }
    throw new Error(`“${clean}” keeps being changed by another program. Nothing was lost; try saving again in a moment.`);
  } finally {
    await fsp.rm(temp, { force: true });
  }
}

// True if "base (…)" already exists in `dir` with exactly these contents.
async function hasCopy(dir, base, ext, buffer) {
  const version = versionOf(buffer);
  for (const file of await fsp.readdir(dir)) {
    if (!file.startsWith(base + ' (') || !file.endsWith(ext)) continue;
    const full = path.join(dir, file);
    if ((await fsp.stat(full)).size !== buffer.length) continue;
    if (versionOf(await fsp.readFile(full)) === version) return true;
  }
  return false;
}

/**
 * Copies a library into another folder without ever overwriting or silently
 * skipping a different file of the same name. For each song or setlist:
 *   not in the destination        -> copied
 *   same contents already there   -> counted as identical
 *   different contents there      -> both kept; this one is added as
 *                                    "Name (<label> date time)"
 * `files` is an iterable of { file, read(): Promise<Buffer> }.
 */
async function mergeInto(dir, files, label, now = () => new Date()) {
  const result = { copied: 0, identical: 0, conflicts: [] };
  for (const { file, read } of files) {
    if (!isLibraryFile(file)) continue;
    const ext = extOf(file);
    const base = file.slice(0, -ext.length);
    const target = path.join(dir, file);
    const buffer = await read();
    if (await writeNew(target, buffer)) { result.copied++; continue; }
    const present = await readIfExists(target);
    if (present && versionOf(present) === versionOf(buffer)) { result.identical++; continue; }
    // Merging the same folder again must not pile up duplicate copies.
    if (await hasCopy(dir, base, ext, buffer)) { result.identical++; continue; }
    result.conflicts.push({ name: base, savedAs: await placeUnique(dir, base, ext, label, now(), { buffer }) });
  }
  return result;
}

/** Moves every library file of `from` into `to` (see mergeInto). `from` is left untouched. */
async function migrateLibrary(from, to, now) {
  const files = (await fsp.readdir(from)).filter(isLibraryFile).map((file) => ({ file, read: () => fsp.readFile(path.join(from, file)) }));
  return mergeInto(to, files, 'copy from previous folder', now);
}

/**
 * Cleans up after a crash in the middle of a save. A version that had been
 * moved aside but not yet dealt with is brought back as "Name (recovered copy
 * …)"; stale working files of unfinished saves are removed.
 */
async function recoverOrphans(dir, { now = () => new Date(), minAgeMs = 120000 } = {}) {
  const recovered = [];
  for (const file of await fsp.readdir(dir)) {
    if (!file.endsWith('.tmp')) continue;
    const full = path.join(dir, file);
    let stat;
    try { stat = await fsp.stat(full); } catch { continue; }
    if (now().getTime() - stat.mtimeMs < minAgeMs) continue;
    const marker = file.indexOf(SONG_EXT + '.old.');
    if (marker > 0) recovered.push(await placeUnique(dir, file.slice(0, marker), SONG_EXT, 'recovered copy', now(), { fromPath: full }));
    else if (/\.new\.\d+\.\d+\.\d+\.tmp$/.test(file)) await fsp.rm(full, { force: true });
  }
  return recovered;
}

module.exports = {
  versionOf, isLibraryFile, readIfExists, placeExclusive, writeNew, writeAtomic, placeUnique, renameExclusive,
  writeSong, mergeInto, migrateLibrary, recoverOrphans,
};
