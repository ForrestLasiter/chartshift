// Updating from GitHub releases: version comparison, choosing the installer,
// and checking the download. No network: GitHub's answers are stood in for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import update from '../electron/update.cjs';

const MB = 1024 * 1024;
const release = (over = {}, assetOver = {}) => ({
  tag_name: 'v0.7.0', draft: false, prerelease: false, body: 'What is new',
  assets: [{ name: 'ChartShift-Setup-0.7.0.exe', size: 2 * MB, browser_download_url: 'https://github.com/ForrestLasiter/chartshift/releases/download/v0.7.0/ChartShift-Setup-0.7.0.exe', ...assetOver }],
  ...over,
});
const json = (body, status = 200) => async () => new Response(JSON.stringify(body), { status });

test('versions are compared number by number', () => {
  assert.deepEqual(update.parseVersion('v0.6.1'), [0, 6, 1]);
  assert.deepEqual(update.parseVersion('1.20.3'), [1, 20, 3]);
  for (const bad of ['', 'latest', '1.2', 'v1.2.3-beta', '1.2.3.4', null, 'v1.2.x']) assert.equal(update.parseVersion(bad), null, String(bad));
  assert.ok(update.isNewer('0.6.2', '0.6.1'));
  assert.ok(update.isNewer('v0.10.0', '0.9.9'), '0.10 is later than 0.9');
  assert.ok(update.isNewer('1.0.0', '0.99.99'));
  assert.ok(!update.isNewer('0.6.1', '0.6.1'));
  assert.ok(!update.isNewer('0.6.0', '0.6.1'));
  assert.ok(!update.isNewer('nonsense', '0.6.1'), 'an unreadable version is never treated as an update');
});

test('the installer is taken only from where a ChartShift release keeps it', () => {
  const ok = update.pickInstaller(release());
  assert.deepEqual([ok.version, ok.name, ok.size, ok.sha256, ok.notes], ['0.7.0', 'ChartShift-Setup-0.7.0.exe', 2 * MB, null, 'What is new']);
  assert.equal(update.pickInstaller(release({}, { digest: `sha256:${'ab'.repeat(32)}` })).sha256, 'ab'.repeat(32));
  const refused = [
    [release({ draft: true }), /could not be read/],
    [release({ prerelease: true }), /could not be read/],
    [release({ tag_name: 'nightly' }), /could not be read/],
    [release({ assets: [] }), /no installer attached/],
    [release({}, { name: 'ChartShift-Setup-0.6.0.exe' }), /no installer attached/],
    [release({}, { name: 'evil.exe' }), /no installer attached/],
    [release({}, { browser_download_url: 'https://example.com/ChartShift-Setup-0.7.0.exe' }), /not where it should be/],
    [release({}, { browser_download_url: 'https://github.com/someone-else/chartshift/releases/download/v0.7.0/ChartShift-Setup-0.7.0.exe' }), /not where it should be/],
    [release({}, { browser_download_url: 'https://github.com/ForrestLasiter/chartshift/releases/download/v0.6.0/ChartShift-Setup-0.7.0.exe' }), /not where it should be/],
    [release({}, { size: 10 }), /unexpected size/],
    [release({}, { size: 5000 * MB }), /unexpected size/],
    [null, /could not be read/],
  ];
  for (const [input, pattern] of refused) assert.throws(() => update.pickInstaller(input), pattern);
});

test('checking reports whether a newer version exists, and explains failures', async () => {
  const newer = await update.checkLatest(json(release()), '0.6.1');
  assert.deepEqual([newer.available, newer.version, newer.current], [true, '0.7.0', '0.6.1']);
  assert.equal((await update.checkLatest(json(release()), '0.7.0')).available, false);
  assert.equal((await update.checkLatest(json(release()), '0.8.0')).available, false, 'an older release is not offered');
  let asked = null;
  await update.checkLatest(async (url) => { asked = url; return new Response(JSON.stringify(release())); }, '0.1.0');
  assert.equal(asked, 'https://api.github.com/repos/ForrestLasiter/chartshift/releases/latest');
  await assert.rejects(update.checkLatest(async () => { throw new Error('offline'); }, '0.6.1'), /Could not reach GitHub/);
  await assert.rejects(update.checkLatest(json({}, 403), '0.6.1'), /limiting requests/);
  await assert.rejects(update.checkLatest(json({}, 500), '0.6.1'), /error \(500\)/);
  await assert.rejects(update.checkLatest(async () => new Response('<html>'), '0.6.1'), /could not be read/);
});

// A stand-in installer of exactly 1 MB + 5 bytes, served in chunks.
const bytes = Buffer.alloc(MB + 5, 7);
const sha = crypto.createHash('sha256').update(bytes).digest('hex');
const installer = (over = {}) => ({ version: '0.7.0', name: 'ChartShift-Setup-0.7.0.exe', url: 'https://github.com/x', size: bytes.length, sha256: sha, ...over });
const serve = (data, status = 200) => async () => new Response(new ReadableStream({
  start(controller) { for (let i = 0; i < data.length; i += 200000) controller.enqueue(data.subarray(i, i + 200000)); controller.close(); },
}), { status });
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chartshift-update-test-'));

test('a download that matches its size and digest is kept, with progress reported', async () => {
  const dir = scratch();
  const seen = [];
  const result = await update.downloadInstaller(installer(), dir, { fetchImpl: serve(bytes), onProgress: (got, total) => seen.push([got, total]) });
  assert.equal(result.path, path.join(dir, 'ChartShift-Setup-0.7.0.exe'));
  assert.equal(result.verified, 'digest');
  assert.ok(fs.readFileSync(result.path).equals(bytes));
  assert.deepEqual(seen[seen.length - 1], [bytes.length, bytes.length]);
  assert.ok(seen.length >= 5 && seen.every(([got], i) => i === 0 || got > seen[i - 1][0]));
  assert.deepEqual(fs.readdirSync(dir), ['ChartShift-Setup-0.7.0.exe'], 'no partial file is left');
  assert.equal((await update.downloadInstaller(installer({ sha256: null }), dir, { fetchImpl: serve(bytes) })).verified, 'size');
});

test('a download that is altered, cut short or too long is thrown away', async () => {
  const tampered = Buffer.from(bytes); tampered[1000] = 9;
  for (const [label, data, pattern] of [
    ['altered', tampered, /did not match/],
    ['cut short', bytes.subarray(0, 500000), /did not match/],
    ['too long', Buffer.concat([bytes, Buffer.alloc(300000)]), /larger than it should be/],
  ]) {
    const dir = scratch();
    await assert.rejects(update.downloadInstaller(installer(), dir, { fetchImpl: serve(data) }), pattern, label);
    assert.deepEqual(fs.readdirSync(dir), [], `${label}: nothing is left behind`);
  }
  const dir = scratch();
  await assert.rejects(update.downloadInstaller(installer(), dir, { fetchImpl: serve(bytes, 404) }), /download failed \(404\)/);
  await assert.rejects(update.downloadInstaller(installer(), dir, { fetchImpl: async () => { throw new Error('offline'); } }), /could not start/);
  assert.deepEqual(fs.readdirSync(dir), []);
});
