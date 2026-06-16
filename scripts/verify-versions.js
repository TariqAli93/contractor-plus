/**
 * scripts/verify-versions.js
 *
 * Build-time guard against version drift across the monorepo. The app version
 * must be identical in all FOUR package manifests, otherwise packaged installers
 * and the /version handshake can disagree.
 *
 * Sources checked (must all be identical):
 *   1. package.json#version                   (repo root — the source of truth)
 *   2. frontend/package.json#version          (Electron desktop client)
 *   3. backend/package.json#version           (reported by GET /version → app)
 *   4. packages/shared/package.json#version
 *
 * Optional cross-checks (only when the artifact exists):
 *   5. dist-backend/package.json#version                                  (after build:backend-bundle)
 *   6. release/win-unpacked/resources/backend/package.json#version        (after package)
 *
 * NOTE: the runtime frontend⇄backend compatibility gate is the integer
 * PROTOCOL_VERSION (packages/shared/src/service/protocol.ts), checked by the
 * desktop client against GET /version. That is intentionally decoupled from the
 * marketing version synced here.
 *
 * Exit 0 → consistent; non-zero → drift, with a diff printed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');

function readJsonVersion(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return { rel, version: null, exists: false };
  try {
    const json = JSON.parse(fs.readFileSync(abs, 'utf8'));
    return { rel, version: json.version || null, exists: true };
  } catch (err) {
    return { rel, version: null, exists: true, error: err.message };
  }
}

function fail(msg) {
  console.error(`[verify-versions] ❌ ${msg}`);
  process.exit(1);
}

const required = [
  readJsonVersion('package.json'),
  readJsonVersion('frontend/package.json'),
  readJsonVersion('backend/package.json'),
  readJsonVersion('packages/shared/package.json'),
];

const optional = [
  readJsonVersion('dist-backend/package.json'),
  readJsonVersion('release/win-unpacked/resources/backend/package.json'),
].filter((e) => e.exists);

const errors = required.filter((e) => e.error);
for (const e of errors) console.error(`[verify-versions] ❌ ${e.rel}: ${e.error}`);
if (errors.length > 0) process.exit(1);

const missing = required.filter((e) => !e.version);
if (missing.length > 0) {
  for (const m of missing) console.error(`[verify-versions] ❌ ${m.rel}: missing/empty version field`);
  process.exit(1);
}

const truth = required[0].version; // root package.json
const all = [...required, ...optional];

let ok = true;
console.log('[verify-versions] expected version (from root package.json):', truth);
for (const entry of all) {
  const sym = entry.version === truth ? '✓' : '✗';
  console.log(`[verify-versions] ${sym} ${entry.rel}: ${entry.version}`);
  if (entry.version !== truth) ok = false;
}

if (!ok) {
  fail(
    'Version drift detected.\n' +
      '   Fix: run `node pumb-version.js <x.y.z>` to sync all four package.json files,\n' +
      '   then re-run `pnpm run clean` and `pnpm run package`.',
  );
}

console.log('[verify-versions] ✅ all version locations are consistent');
