// Library file operations against a real (temporary) folder: nothing may be
// lost when names collide, saves race, or a folder is merged into another.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import store from '../electron/songStore.cjs';
import safety from '../electron/safety.cjs';

const SONG = '.chartshift';
const FIXED = () => new Date(2026, 9, 3, 14, 5, 9); // every copy made in the same second
const bytes = (text) => Buffer.from(text);

function folder() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chartshift-test-'));
  return {
    dir,
    put: (file, text) => fs.writeFileSync(path.join(dir, file), text),
    get: (file) => fs.readFileSync(path.join(dir, file), 'utf8'),
    files: () => fs.readdirSync(dir).sort(),
    contents: () => Object.fromEntries(fs.readdirSync(dir).sort().map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')])),
  };
}
const noTemps = (lib) => assert.deepEqual(lib.files().filter((f) => f.endsWith('.tmp')), [], 'no working files left behind');

// --- 2. Unique conflict-copy names -----------------------------------------------

test('copy names made in the same second are distinct', () => {
  const names = [1, 2, 3].map((n) => safety.copyName('Song', 'conflict copy', FIXED(), n));
  assert.deepEqual(names, ['Song (conflict copy 2026-10-03 14.05.09)', 'Song (conflict copy 2026-10-03 14.05.09 #2)', 'Song (conflict copy 2026-10-03 14.05.09 #3)']);
  for (const n of [1, 2, 9999]) {
    const name = safety.copyName('x'.repeat(300), 'conflict copy', FIXED(), n);
    assert.ok(name.length <= 120 && safety.safeName(name) === name);
  }
});

test('repeated conflicts in the same second never overwrite each other', async () => {
  const lib = folder();
  const made = [];
  for (const text of ['one', 'two', 'three', 'four']) made.push(await store.placeUnique(lib.dir, 'Song', SONG, 'conflict copy', FIXED(), { buffer: bytes(text) }));
  assert.equal(new Set(made).size, 4);
  assert.deepEqual(made.map((name) => lib.get(name + SONG)), ['one', 'two', 'three', 'four'], 'each copy still has its own contents');
  noTemps(lib);
});

test('a copy name that is already taken is skipped, not overwritten', async () => {
  const lib = folder();
  const taken = safety.copyName('Song', 'my copy', FIXED());
  lib.put(taken + SONG, 'precious');
  lib.put('Song' + SONG, 'theirs');
  const first = await store.writeSong(lib.dir, 'Song', bytes('mine 1'), { expect: 'stale', onConflict: 'copy' }, { now: FIXED });
  const second = await store.writeSong(lib.dir, 'Song', bytes('mine 2'), { expect: 'stale', onConflict: 'copy' }, { now: FIXED });
  assert.equal(lib.get(taken + SONG), 'precious');
  assert.equal(lib.get('Song' + SONG), 'theirs');
  assert.notEqual(first.name, taken);
  assert.notEqual(first.name, second.name);
  assert.equal(lib.get(first.name + SONG), 'mine 1');
  assert.equal(lib.get(second.name + SONG), 'mine 2');
  noTemps(lib);
});

test('replacing repeatedly in the same second keeps every replaced version', async () => {
  const lib = folder();
  lib.put('Song' + SONG, 'v0');
  const kept = [];
  for (const text of ['v1', 'v2', 'v3']) {
    const result = await store.writeSong(lib.dir, 'Song', bytes(text), { expect: 'stale', onConflict: 'replace' }, { now: FIXED });
    kept.push(...result.kept);
  }
  assert.equal(lib.get('Song' + SONG), 'v3');
  assert.deepEqual(kept.map((name) => lib.get(name + SONG)), ['v0', 'v1', 'v2']);
  assert.equal(lib.files().length, 4);
  noTemps(lib);
});

// --- 3. Saves that race with another writer ----------------------------------------

test('a normal save of an unchanged song replaces it and keeps nothing extra', async () => {
  const lib = folder();
  const first = await store.writeSong(lib.dir, 'Song', bytes('v1'));
  const second = await store.writeSong(lib.dir, 'Song', bytes('v2'), { expect: first.version });
  assert.equal(second.kept, null);
  assert.deepEqual(lib.contents(), { ['Song' + SONG]: 'v2' });
});

test('asking first: a changed song is reported and left untouched', async () => {
  const lib = folder();
  lib.put('Song' + SONG, 'theirs');
  const result = await store.writeSong(lib.dir, 'Song', bytes('mine'), { expect: 'what-i-opened' });
  assert.equal(result.conflict.reason, 'changed');
  assert.deepEqual(lib.contents(), { ['Song' + SONG]: 'theirs' });
});

test('a version that arrives between the check and the write is preserved', async () => {
  const lib = folder();
  const opened = await store.writeSong(lib.dir, 'Song', bytes('v1'));
  // The check sees v1 (as expected) - then another writer saves before our file lands.
  const result = await store.writeSong(lib.dir, 'Song', bytes('mine'), { expect: opened.version }, {
    now: FIXED,
    hooks: { afterCheck: () => lib.put('Song' + SONG, 'arrived during the save') },
  });
  assert.equal(lib.get('Song' + SONG), 'mine');
  assert.equal(result.kept.length, 1);
  assert.equal(lib.get(result.kept[0] + SONG), 'arrived during the save', 'the unseen version was kept, not overwritten');
  noTemps(lib);
});

test('a file that appears at the last moment, where none existed, is preserved', async () => {
  const lib = folder();
  const result = await store.writeSong(lib.dir, 'New song', bytes('mine'), {}, {
    now: FIXED,
    hooks: { beforePlace: (attempt) => { if (attempt === 0) lib.put('New song' + SONG, 'someone else got there first'); } },
  });
  assert.equal(lib.get('New song' + SONG), 'mine');
  assert.equal(lib.get(result.kept[0] + SONG), 'someone else got there first');
  noTemps(lib);
});

test('several versions arriving during one save are all preserved', async () => {
  const lib = folder();
  const opened = await store.writeSong(lib.dir, 'Song', bytes('v1'));
  const arrivals = ['a', 'b', 'c'];
  const result = await store.writeSong(lib.dir, 'Song', bytes('mine'), { expect: opened.version }, {
    now: FIXED,
    hooks: { beforePlace: (attempt) => { if (attempt < arrivals.length) lib.put('Song' + SONG, arrivals[attempt]); } },
  });
  assert.equal(lib.get('Song' + SONG), 'mine');
  assert.deepEqual(result.kept.map((name) => lib.get(name + SONG)), ['a', 'b', 'c']);
});

test('a song that never stops changing fails safely with every version kept', async () => {
  const lib = folder();
  let n = 0;
  await assert.rejects(
    store.writeSong(lib.dir, 'Song', bytes('mine'), {}, { now: FIXED, hooks: { beforePlace: () => lib.put('Song' + SONG, `other ${n++}`) } }),
    /keeps being changed/,
  );
  const kept = Object.values(lib.contents());
  for (let i = 0; i < n; i++) assert.ok(kept.includes(`other ${i}`), `other ${i} survived`);
  noTemps(lib);
});

test('replacing a different song of the same name sends the old one to the bin', async () => {
  const lib = folder();
  const bin = folder();
  lib.put('Song' + SONG, 'unrelated older song');
  const trash = async (file) => fs.renameSync(file, path.join(bin.dir, path.basename(file)));
  const asked = await store.writeSong(lib.dir, 'Song', bytes('mine'), {}, { trash });
  assert.equal(asked.conflict.reason, 'exists');
  const result = await store.writeSong(lib.dir, 'Song', bytes('mine'), { onConflict: 'replace' }, { trash, now: FIXED });
  assert.equal(result.kept, null);
  assert.deepEqual(lib.contents(), { ['Song' + SONG]: 'mine' });
  assert.deepEqual(bin.contents(), { ['Song' + SONG]: 'unrelated older song' }, 'the old song is recoverable from the bin');
});

test('renaming never overwrites an existing song', async () => {
  const lib = folder();
  lib.put('A' + SONG, 'a');
  lib.put('B' + SONG, 'b');
  assert.equal(await store.renameExclusive(path.join(lib.dir, 'A' + SONG), path.join(lib.dir, 'B' + SONG)), false);
  assert.deepEqual(lib.contents(), { ['A' + SONG]: 'a', ['B' + SONG]: 'b' });
  assert.equal(await store.renameExclusive(path.join(lib.dir, 'A' + SONG), path.join(lib.dir, 'C' + SONG)), true);
  assert.deepEqual(lib.contents(), { ['B' + SONG]: 'b', ['C' + SONG]: 'a' });
});

test('a version set aside by an interrupted save is brought back as a recovered copy', async () => {
  const lib = folder();
  lib.put(`Song${SONG}.old.123.456.0.tmp`, 'set aside, then the power went');
  lib.put(`Song${SONG}.new.123.456.1.tmp`, 'half-finished save');
  lib.put(`Fresh${SONG}.old.123.789.2.tmp`, 'a save still in progress');
  const later = () => new Date(Date.now() + 10 * 60 * 1000);
  fs.utimesSync(path.join(lib.dir, `Fresh${SONG}.old.123.789.2.tmp`), later(), later());
  const recovered = await store.recoverOrphans(lib.dir, { now: later });
  assert.equal(recovered.length, 1);
  assert.equal(lib.get(recovered[0] + SONG), 'set aside, then the power went');
  assert.match(recovered[0], /^Song \(recovered copy /);
  assert.deepEqual(lib.files().filter((f) => f.endsWith('.tmp')), [`Fresh${SONG}.old.123.789.2.tmp`], 'a save in progress is not disturbed');
});

// --- 1. Moving the library to another folder ----------------------------------------

test('moving folders copies, recognises identical files, and keeps both sides of a clash', async () => {
  const from = folder(), to = folder();
  from.put('Only here' + SONG, 'only here');
  from.put('Same' + SONG, 'identical');
  from.put('Clash' + SONG, 'version from this PC');
  from.put('Sunday.setlist.json', '{"songs":["Clash"]}');
  from.put('notes.txt', 'not a library file');
  to.put('Same' + SONG, 'identical');
  to.put('Clash' + SONG, 'version already in the new folder');
  to.put('Sunday.setlist.json', '{"songs":["Same"]}');
  to.put('Already there' + SONG, 'already there');
  const before = from.contents();

  const result = await store.migrateLibrary(from.dir, to.dir, FIXED);

  assert.equal(result.copied, 1);
  assert.equal(result.identical, 1);
  assert.deepEqual(result.conflicts.map((c) => c.name).sort(), ['Clash', 'Sunday']);
  const after = to.contents();
  assert.equal(after['Clash' + SONG], 'version already in the new folder', 'the destination file is not overwritten');
  assert.equal(after['Sunday.setlist.json'], '{"songs":["Same"]}');
  const clash = result.conflicts.find((c) => c.name === 'Clash'), sunday = result.conflicts.find((c) => c.name === 'Sunday');
  assert.equal(after[clash.savedAs + SONG], 'version from this PC', 'the incoming file is kept beside it, not skipped');
  assert.equal(after[sunday.savedAs + '.setlist.json'], '{"songs":["Clash"]}');
  assert.match(clash.savedAs, /^Clash \(copy from previous folder /);
  assert.equal(after['Only here' + SONG], 'only here');
  assert.equal(after['Already there' + SONG], 'already there');
  assert.equal(after['notes.txt'], undefined);
  assert.deepEqual(from.contents(), before, 'the previous folder is left untouched');
  noTemps(to);
});

test('moving the same library twice adds nothing new the second time', async () => {
  const from = folder(), to = folder();
  from.put('A' + SONG, 'a');
  to.put('A' + SONG, 'different');
  const first = await store.migrateLibrary(from.dir, to.dir, FIXED);
  assert.equal(first.conflicts.length, 1);
  const second = await store.migrateLibrary(from.dir, to.dir, FIXED);
  // The clash is recognised as already preserved: no pile of duplicate copies.
  assert.deepEqual(second, { copied: 0, identical: 1, conflicts: [] });
  assert.equal(to.files().length, 2);
  // A genuinely different version arriving later is still kept, under a further unique name.
  from.put('A' + SONG, 'a newer edit');
  const third = await store.migrateLibrary(from.dir, to.dir, FIXED);
  assert.equal(third.conflicts.length, 1);
  assert.notEqual(third.conflicts[0].savedAs, first.conflicts[0].savedAs);
  assert.equal(to.get(first.conflicts[0].savedAs + SONG), 'a', 'the earlier copy is not overwritten');
  assert.equal(to.get(third.conflicts[0].savedAs + SONG), 'a newer edit');
});
