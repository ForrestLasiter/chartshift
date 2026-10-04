// Updating from GitHub releases: find the latest release, download its
// installer, check it arrived intact. No Electron imports here, so it can be
// tested with plain Node; main.cjs wires it to the window and starts the
// installer.
//
// What is trusted: the release list is fetched over HTTPS from this one
// repository on api.github.com, only a release's own "ChartShift-Setup-x.y.z.exe"
// under that repository's download address is accepted, and the downloaded
// file must match the size (and the SHA-256 digest, when GitHub lists one)
// given for it. The installer is not code-signed, so this is as far as the
// check can go.
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const REPO = 'ForrestLasiter/chartshift';
const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const MB = 1024 * 1024;
const MAX_INSTALLER = 400 * MB;

/** "v1.2.3" or "1.2.3" -> [1, 2, 3], or null. */
function parseVersion(text) {
  const match = String(text || '').trim().match(/^v?(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/);
  return match ? match.slice(1).map(Number) : null;
}

/** True when version `a` is later than version `b`. Anything unreadable is never newer. */
function isNewer(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/**
 * Picks the installer out of a release as GitHub describes it, refusing
 * anything that is not exactly what a ChartShift release looks like.
 * Returns { version, name, url, size, sha256, notes } or throws.
 */
function pickInstaller(release) {
  const version = parseVersion(release && release.tag_name);
  if (!version || release.draft || release.prerelease) throw new Error('The latest release could not be read.');
  const tag = String(release.tag_name).trim();
  const wanted = `ChartShift-Setup-${version.join('.')}.exe`;
  const asset = (Array.isArray(release.assets) ? release.assets : []).find((a) => a && a.name === wanted);
  if (!asset) throw new Error(`Version ${version.join('.')} has no installer attached yet.`);
  const expected = `https://github.com/${REPO}/releases/download/${tag}/${wanted}`;
  if (asset.browser_download_url !== expected) throw new Error('The installer is not where it should be, so it was not downloaded.');
  if (!Number.isInteger(asset.size) || asset.size < MB || asset.size > MAX_INSTALLER) throw new Error('The installer is an unexpected size, so it was not downloaded.');
  const digest = typeof asset.digest === 'string' && /^sha256:[0-9a-f]{64}$/i.test(asset.digest) ? asset.digest.slice(7).toLowerCase() : null;
  return {
    version: version.join('.'), name: wanted, url: expected, size: asset.size, sha256: digest,
    notes: typeof release.body === 'string' ? release.body.slice(0, 6000) : '',
  };
}

/** Asks GitHub for the latest release. Returns the installer details plus `available`. */
async function checkLatest(fetchImpl, current) {
  let response;
  try {
    response = await fetchImpl(LATEST_URL, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ChartShift' } });
  } catch {
    throw new Error('Could not reach GitHub. Check the internet connection and try again.');
  }
  if (response.status === 403 || response.status === 429) throw new Error('GitHub is limiting requests from this network just now. Try again in a little while.');
  if (!response.ok) throw new Error(`GitHub answered with an error (${response.status}).`);
  let release;
  try { release = await response.json(); } catch { throw new Error('The answer from GitHub could not be read.'); }
  const installer = pickInstaller(release);
  return { ...installer, current, available: isNewer(installer.version, current) };
}

/**
 * Downloads the installer into `dir` and checks it. Resolves with its path.
 * onProgress(receivedBytes, totalBytes) is called as it arrives. A file that
 * is the wrong size or does not match its digest is deleted and refused.
 */
async function downloadInstaller(installer, dir, { fetchImpl, onProgress } = {}) {
  await fsp.mkdir(dir, { recursive: true });
  const target = path.join(dir, installer.name);
  const partial = `${target}.part`;
  let response;
  try {
    response = await fetchImpl(installer.url, { headers: { 'User-Agent': 'ChartShift' } });
  } catch {
    throw new Error('The download could not start. Check the internet connection and try again.');
  }
  if (!response.ok || !response.body) throw new Error(`The download failed (${response.status}).`);
  const hash = crypto.createHash('sha256');
  const file = await fsp.open(partial, 'w');
  let received = 0;
  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > installer.size) throw new Error('The download was larger than it should be, so it was thrown away.');
      hash.update(value);
      await file.write(value);
      if (onProgress) onProgress(received, installer.size);
    }
  } catch (error) {
    await file.close();
    await fsp.rm(partial, { force: true });
    throw error.message.includes('thrown away') ? error : new Error('The download was interrupted. Try again.');
  }
  await file.close();
  const digest = hash.digest('hex');
  if (received !== installer.size || (installer.sha256 && digest !== installer.sha256)) {
    await fsp.rm(partial, { force: true });
    throw new Error('The downloaded installer did not match what GitHub lists, so it was thrown away. Try again.');
  }
  await fsp.rm(target, { force: true });
  await fsp.rename(partial, target);
  return { path: target, sha256: digest, verified: installer.sha256 ? 'digest' : 'size' };
}

module.exports = { REPO, LATEST_URL, parseVersion, isNewer, pickInstaller, checkLatest, downloadInstaller };
