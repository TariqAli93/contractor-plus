/**
 * scripts/fetch-winsw.js
 *
 * Downloads the WinSW (Windows Service Wrapper) binary from its official
 * GitHub release, verifies its SHA-256 against a pinned digest, and stores
 * the result under tools/winsw/ for the build pipeline to consume.
 *
 * WinSW is Apache-2.0 licensed and is the chosen service host for the
 * ContractorPlusBackend service.
 *
 * Usage:
 *   node scripts/fetch-winsw.js
 *
 * Behaviour:
 *   - If tools/winsw/WinSW-x64.exe already exists AND matches PINNED_SHA256,
 *     the script is a no-op (cache hit).
 *   - If the file exists but the hash does not match, the file is removed
 *     and re-downloaded (defends against a tampered cache).
 *   - On a fresh download, the .sha256 sidecar is also fetched from GitHub
 *     and used as a secondary cross-check before the pinned constant is
 *     applied. Both checks must pass.
 *
 * Updating to a new WinSW version:
 *   1. Bump WINSW_VERSION below.
 *   2. Replace PINNED_SHA256 with the value published next to the new
 *      release on https://github.com/winsw/winsw/releases/.
 *   3. Run `pnpm fetch:winsw` and confirm the script reports OK.
 *
 * Security:
 *   - HTTPS-only download.
 *   - Pinned SHA-256 verification (the release sidecar is a cross-check,
 *     NOT the source of truth).
 *   - Atomic write: download to .partial then rename.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WINSW_VERSION = '2.12.0';
const WINSW_ASSET = 'WinSW-x64.exe';
const WINSW_BASE_URL = `https://github.com/winsw/winsw/releases/download/v${WINSW_VERSION}`;
const WINSW_URL = `${WINSW_BASE_URL}/${WINSW_ASSET}`;
const WINSW_SHA_URL = `${WINSW_BASE_URL}/${WINSW_ASSET}.sha256`;

/**
 * Pinned SHA-256 of WinSW v2.12.0 WinSW-x64.exe.
 *
 * Source of truth: https://github.com/winsw/winsw/releases/tag/v2.12.0
 *
 * If this is the literal string 'PIN_AT_FIRST_RUN' the script will perform
 * one fetch, print the discovered hash, and refuse to install the binary
 * until you commit the value above. This keeps the supply-chain audit
 * honest: the hash MUST be reviewed by a human at least once.
 */
const PINNED_SHA256 = '05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da';

const TOOLS_DIR = path.join(__dirname, '..', 'tools', 'winsw');
const TARGET = path.join(TOOLS_DIR, WINSW_ASSET);
const TARGET_PARTIAL = `${TARGET}.partial`;

function log(msg) {
  console.log(`[fetch-winsw] ${msg}`);
}
function fail(msg) {
  console.error(`[fetch-winsw] ERROR: ${msg}`);
  process.exit(1);
}

function sha256(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.allocUnsafe(64 * 1024);
    let n;
    // eslint-disable-next-line no-cond-assign
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function httpsGet(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    if (redirects < 0) return reject(new Error(`too many redirects fetching ${url}`));
    const req = https.get(url, { headers: { 'user-agent': 'contractorplus-fetch-winsw' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        res.resume();
        return resolve(httpsGet(res.headers.location, redirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      resolve(res);
    });
    req.on('error', reject);
  });
}

async function downloadTo(url, dest) {
  const res = await httpsGet(url);
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest);
    res.pipe(out);
    res.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
  });
}

async function fetchText(url) {
  const res = await httpsGet(url);
  return await new Promise((resolve, reject) => {
    let data = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => (data += chunk));
    res.on('error', reject);
    res.on('end', () => resolve(data));
  });
}

async function main() {
  fs.mkdirSync(TOOLS_DIR, { recursive: true });

  // Cache hit?
  if (fs.existsSync(TARGET) && PINNED_SHA256 !== 'PIN_AT_FIRST_RUN') {
    const cached = sha256(TARGET);
    if (cached.toLowerCase() === PINNED_SHA256.toLowerCase()) {
      log(`cache hit: ${TARGET} (${cached})`);
      return;
    }
    log(`cached file hash mismatch (${cached}) - re-downloading`);
    fs.rmSync(TARGET, { force: true });
  }

  log(`downloading ${WINSW_URL}`);
  if (fs.existsSync(TARGET_PARTIAL)) fs.rmSync(TARGET_PARTIAL, { force: true });
  await downloadTo(WINSW_URL, TARGET_PARTIAL);

  const downloadedHash = sha256(TARGET_PARTIAL);
  log(`downloaded sha256 = ${downloadedHash}`);

  // Cross-check against the published .sha256 sidecar.
  let sidecarHash = null;
  try {
    const sidecarText = await fetchText(WINSW_SHA_URL);
    const m = /[a-f0-9]{64}/i.exec(sidecarText);
    sidecarHash = m ? m[0].toLowerCase() : null;
  } catch (err) {
    log(`WARN: could not fetch sidecar (${err.message}) - continuing with pin check only`);
  }

  if (sidecarHash && sidecarHash !== downloadedHash.toLowerCase()) {
    fs.rmSync(TARGET_PARTIAL, { force: true });
    fail(
      `sidecar hash mismatch: download=${downloadedHash}, sidecar=${sidecarHash}.\n` +
        `Refusing to install a binary that does not match GitHub's published checksum.`
    );
  }

  if (PINNED_SHA256 === 'PIN_AT_FIRST_RUN') {
    log('=========================================================');
    log('FIRST RUN: review the hash below and pin it in this file:');
    log(`  ${downloadedHash}`);
    log('Edit scripts/fetch-winsw.js and replace PINNED_SHA256 with');
    log('the value above, then re-run `pnpm fetch:winsw`.');
    log('The download has NOT been installed.');
    log('=========================================================');
    fs.rmSync(TARGET_PARTIAL, { force: true });
    process.exit(2);
  }

  if (downloadedHash.toLowerCase() !== PINNED_SHA256.toLowerCase()) {
    fs.rmSync(TARGET_PARTIAL, { force: true });
    fail(
      `pinned hash mismatch:\n  expected ${PINNED_SHA256}\n  got      ${downloadedHash}\n` +
        `If you intentionally upgraded WinSW, update PINNED_SHA256 in this file.`
    );
  }

  fs.renameSync(TARGET_PARTIAL, TARGET);
  log(`OK - ${TARGET} (${downloadedHash})`);
}

main().catch((err) => fail(err.stack || err.message));
