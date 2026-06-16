// pumb-version.js
//
// Single source-of-truth version bumper for the Contractor Plus monorepo.
//
// The app version must be identical across FOUR package manifests, otherwise
// the packaged installer name, the backend /version handshake, and verify-versions
// disagree:
//
//   1. package.json#version                  (repo root — source of truth)
//   2. frontend/package.json#version          (Electron desktop client)
//   3. backend/package.json#version           (reported by GET /version → app)
//   4. packages/shared/package.json#version
//
// The frontend⇄backend runtime gate is the integer PROTOCOL_VERSION in
// packages/shared/src/service/protocol.ts — bump THAT by hand only when the
// request/response contract changes incompatibly (it is independent of this
// marketing version).
//
// Usage:
//   node pumb-version.js               # bump patch (x.y.z → x.y.z+1)
//   node pumb-version.js 1.2.3         # set explicit version
//   node pumb-version.js --check       # exit non-zero if any of the four drift

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.dirname(__filename);

const PACKAGES = [
  path.join(ROOT, 'package.json'),
  path.join(ROOT, 'frontend', 'package.json'),
  path.join(ROOT, 'backend', 'package.json'),
  path.join(ROOT, 'packages', 'shared', 'package.json'),
];

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function bumpPatch(version) {
  if (!version) return '0.0.1';
  const [major = '0', minor = '0', patch = '0'] = version.split('.');
  return `${parseInt(major, 10)}.${parseInt(minor, 10)}.${parseInt(patch, 10) + 1}`;
}

export async function readAllVersions() {
  const out = {};
  for (const p of PACKAGES) {
    const json = await readJson(p);
    out[path.relative(ROOT, p)] = json.version || null;
  }
  return out;
}

async function bumpAll(nextVersion) {
  for (const p of PACKAGES) {
    const json = await readJson(p);
    json.version = nextVersion;
    await writeJson(p, json);
  }
  console.log(`✅ Version updated to ${nextVersion} in:`);
  for (const p of PACKAGES) console.log(`   - ${path.relative(ROOT, p)}`);
}

async function main() {
  const arg = process.argv[2];

  if (arg === '--check' || arg === '-c') {
    const versions = await readAllVersions();
    const entries = Object.entries(versions);
    const truth = entries[0][1];
    let consistent = true;
    console.log('Versions:');
    for (const [rel, v] of entries) {
      console.log(`   ${v === truth && v !== null ? '✓' : '✗'} ${rel} = ${v}`);
      if (v !== truth || v === null) consistent = false;
    }
    if (!consistent) {
      console.error('❌ Versions are inconsistent.');
      process.exit(1);
    }
    console.log('✅ All four version locations are in sync.');
    return;
  }

  let nextVersion;
  if (arg && SEMVER_RE.test(arg)) {
    nextVersion = arg;
  } else if (arg) {
    console.error(`❌ Invalid version argument: ${arg}. Expected x.y.z or --check.`);
    process.exit(1);
  } else {
    const rootPkg = await readJson(PACKAGES[0]);
    nextVersion = bumpPatch(rootPkg.version || '0.0.0');
  }

  await bumpAll(nextVersion);
}

main().catch((err) => {
  console.error('❌ Failed to bump version:', err);
  process.exit(1);
});
