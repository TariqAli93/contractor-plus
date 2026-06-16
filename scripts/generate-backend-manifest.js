#!/usr/bin/env node
/**
 * generate-backend-manifest.js
 *
 * Produces a deterministic SHA-256 manifest for the built backend bundle.
 * The manifest is consumed by:
 *   - release-time integrity checks
 *   - electron's backendUpdater (expectedHash passed to applyBackendUpdate)
 *
 * Output layout at <repoRoot>/dist-backend-manifest/
 *   backend-manifest.json   — machine-readable: { version, rootHash, files: [...] }
 *   backend-manifest.txt    — the exact plaintext that was hashed (git-diffable)
 *   backend-bundle.zip      — the backend bundle packaged for release download
 *
 * The root hash is sha256 over a deterministic "<filehash>  <relpath>" listing
 * (forward-slash paths, sorted) of the dist-backend bundle — usable by a future
 * in-app backend-update integrity check.
 *
 * Usage:
 *   node scripts/generate-backend-manifest.js
 *   # expects `dist-backend/` to already exist (run build-backend.js first)
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\//, ''), '..');
const BUNDLE_DIR = path.join(REPO_ROOT, 'dist-backend');
const OUTPUT_DIR = path.join(REPO_ROOT, 'dist-backend-manifest');

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const buf = Buffer.allocUnsafe(64 * 1024);
  const fd = fs.openSync(filePath, 'r');
  try {
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

function walkFiles(root) {
  const files = [];
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    const abs = path.join(root, rel);
    const entries = fs.readdirSync(abs, { withFileTypes: true });
    for (const entry of entries) {
      const childRel = rel ? path.join(rel, entry.name) : entry.name;
      if (entry.isSymbolicLink()) {
        throw new Error(`Refusing to hash symlink: ${childRel}`);
      }
      if (entry.isDirectory()) {
        stack.push(childRel);
      } else if (entry.isFile()) {
        files.push(childRel);
      }
    }
  }
  return files.sort();
}

function main() {
  if (!fs.existsSync(BUNDLE_DIR)) {
    console.error(`[manifest] ${BUNDLE_DIR} not found — run build-backend.js first`);
    process.exit(1);
  }

  const pkgPath = path.join(BUNDLE_DIR, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.error(`[manifest] ${pkgPath} missing — bundle is incomplete`);
    process.exit(1);
  }
  const { version } = require(pkgPath);
  if (!version) {
    console.error('[manifest] bundle package.json has no version');
    process.exit(1);
  }

  const files = walkFiles(BUNDLE_DIR);
  console.log(`[manifest] hashing ${files.length} files for v${version}...`);

  const entries = files.map((rel) => {
    const hex = sha256File(path.join(BUNDLE_DIR, rel));
    const normalized = rel.split(path.sep).join('/');
    return { path: normalized, sha256: hex };
  });

  // Plaintext layout mirrors security.js sha256Directory():
  //   <hex>  <rel-with-forward-slashes>\n
  const manifestText = entries.map((e) => `${e.sha256}  ${e.path}`).join('\n') + '\n';
  const rootHash = crypto.createHash('sha256').update(manifestText).digest('hex');

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const manifestJson = {
    name: 'contractor-plus-backend',
    version,
    rootHash,
    algorithm: 'sha256',
    fileCount: entries.length,
    generatedAt: new Date().toISOString(),
    files: entries,
  };

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'backend-manifest.json'),
    JSON.stringify(manifestJson, null, 2)
  );
  fs.writeFileSync(path.join(OUTPUT_DIR, 'backend-manifest.txt'), manifestText);

  console.log(`[manifest] v${version}`);
  console.log(`[manifest] rootHash  : ${rootHash}`);
  console.log(`[manifest] fileCount : ${entries.length}`);
  console.log(`[manifest] output    : ${OUTPUT_DIR}`);
}

main();
