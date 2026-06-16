/**
 * scripts/fetch-node.js
 *
 * Downloads a standalone Windows x64 Node.js runtime (node.exe) from the
 * official nodejs.org distribution, verifies its SHA-256 against the signed
 * SHASUMS256.txt published alongside the release, and stores it under
 * tools/node/ for build-backend.js to bundle as the backend service host.
 *
 * Why a standalone node.exe (not Electron's binary)?
 *   The backend runs as the independent Windows Service "ContractorPlusBackend".
 *   Shipping a plain node.exe keeps the service fully decoupled from the desktop
 *   client and ABI-agnostic (Prisma's query engine is a standalone binary, not a
 *   node native addon, so a vanilla node.exe runs it fine).
 *
 * Usage:
 *   node scripts/fetch-node.js
 *
 * Behaviour mirrors fetch-winsw.js: cache-hit when the file already matches,
 * atomic .partial download, HTTPS-only, integrity verified against the official
 * checksum file (the source of truth) before the binary is installed.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Pinned to a Node 20 LTS line (backend engines: ">=20"). Bump deliberately.
const NODE_VERSION = '20.18.1';
const PLATFORM_DIR = 'win-x64';
const ASSET_REL = `${PLATFORM_DIR}/node.exe`;
const BASE_URL = `https://nodejs.org/dist/v${NODE_VERSION}`;
const NODE_URL = `${BASE_URL}/${ASSET_REL}`;
const SHASUMS_URL = `${BASE_URL}/SHASUMS256.txt`;

const TOOLS_DIR = path.join(__dirname, '..', 'tools', 'node');
const TARGET = path.join(TOOLS_DIR, 'node.exe');
const TARGET_PARTIAL = `${TARGET}.partial`;

const log = (msg) => console.log(`[fetch-node] ${msg}`);
const fail = (msg) => {
  console.error(`[fetch-node] ERROR: ${msg}`);
  process.exit(1);
};

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
    const req = https.get(url, { headers: { 'user-agent': 'contractorplus-fetch-node' } }, (res) => {
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

function expectedHashFrom(shasums) {
  // SHASUMS256.txt lines look like: "<hex>  win-x64/node.exe"
  for (const line of shasums.split(/\r?\n/)) {
    const m = line.match(/^([a-f0-9]{64})\s+(.+)$/i);
    if (m && m[2].trim() === ASSET_REL) return m[1].toLowerCase();
  }
  return null;
}

async function main() {
  fs.mkdirSync(TOOLS_DIR, { recursive: true });

  log(`fetching official checksums: ${SHASUMS_URL}`);
  const shasums = await fetchText(SHASUMS_URL);
  const expected = expectedHashFrom(shasums);
  if (!expected) fail(`could not find ${ASSET_REL} in SHASUMS256.txt`);

  // Cache hit?
  if (fs.existsSync(TARGET)) {
    const cached = sha256(TARGET);
    if (cached.toLowerCase() === expected) {
      log(`cache hit: ${TARGET} (${cached})`);
      return;
    }
    log(`cached node.exe hash mismatch (${cached}) - re-downloading`);
    fs.rmSync(TARGET, { force: true });
  }

  log(`downloading ${NODE_URL}`);
  if (fs.existsSync(TARGET_PARTIAL)) fs.rmSync(TARGET_PARTIAL, { force: true });
  await downloadTo(NODE_URL, TARGET_PARTIAL);

  const downloadedHash = sha256(TARGET_PARTIAL);
  log(`downloaded sha256 = ${downloadedHash}`);

  if (downloadedHash.toLowerCase() !== expected) {
    fs.rmSync(TARGET_PARTIAL, { force: true });
    fail(
      `checksum mismatch for ${ASSET_REL}:\n  expected ${expected}\n  got      ${downloadedHash}\n` +
        'Refusing to install a binary that does not match nodejs.org SHASUMS256.txt.',
    );
  }

  fs.renameSync(TARGET_PARTIAL, TARGET);
  log(`OK - ${TARGET} (Node v${NODE_VERSION}, ${downloadedHash})`);
}

main().catch((err) => fail(err.stack || err.message));
