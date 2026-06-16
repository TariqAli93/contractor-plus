/**
 * scripts/verify-packaged-backend.js
 *
 * Final guardrail after electron-builder finishes. Confirms the unpacked Windows
 * build contains a complete TypeScript + Prisma backend tree under
 * resources/backend. If afterPack was skipped or the output was tampered with,
 * this fails the build.
 *
 * Runs against: release/win-unpacked/resources/backend
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const PACKAGED_BACKEND = path.join(ROOT, 'release', 'win-unpacked', 'resources', 'backend');

const REQUIRED = [
  'dist/server.js',
  'dist/setup/bootstrap.js',
  'package.json',
  'bin/node.exe',
  'prisma/schema.prisma',
  'prisma/migrations',
  'node_modules/@prisma/client/package.json',
  'node_modules/.prisma/client',
  'node_modules/prisma/build/index.js',
  'node_modules/fastify/package.json',
  'node_modules/@contractor-plus/shared/package.json',
  'ContractorPlusBackend.exe',
  'ContractorPlusBackend.xml',
  'service/install-service.cmd',
  'service/repair-service.ps1',
  'service/provision-elevated.ps1',
];

// The packaged SPA the service serves (single origin).
const PACKAGED_FRONTEND = path.join(ROOT, 'release', 'win-unpacked', 'resources', 'frontend', 'index.html');

function fail(msg) {
  console.error(`[verify-packaged-backend] ❌ ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(PACKAGED_BACKEND)) {
  fail(
    `packaged backend directory not found: ${path.relative(ROOT, PACKAGED_BACKEND)}\n` +
      'electron-builder may have skipped the Windows target, or afterPack failed to produce resources/backend.',
  );
}

const missing = [];
for (const rel of REQUIRED) {
  const abs = path.join(PACKAGED_BACKEND, rel);
  if (!fs.existsSync(abs)) missing.push(rel);
  else console.log(`[verify-packaged-backend] ✓ resources/backend/${rel}`);
}

if (!fs.existsSync(PACKAGED_FRONTEND)) {
  missing.push('../frontend/index.html (packaged SPA)');
} else {
  console.log('[verify-packaged-backend] ✓ resources/frontend/index.html');
}

if (missing.length > 0) {
  fail('packaged build is incomplete. Missing:\n  - ' + missing.map((m) => `resources/backend/${m}`).join('\n  - '));
}

console.log('[verify-packaged-backend] ✅ release/win-unpacked/resources is complete');
