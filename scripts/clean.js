/**
 * scripts/clean.js
 *
 * Removes all build artifacts so every production build starts from a known
 * empty state. Run from the repo root via `pnpm run clean`.
 *
 * Targets (relative to repo root):
 *   - dist-backend            (backend bundle produced by build-backend.js)
 *   - dist-backend-manifest   (integrity manifest)
 *   - release                 (electron-builder server output)
 *   - release-client          (electron-builder client output)
 *   - frontend/dist           (vite renderer output)
 *   - backend/dist            (tsc backend output)
 *
 * The downloaded build tools (tools/winsw, tools/node) are intentionally NOT
 * cleaned — they are content-verified caches.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const TARGETS = [
  'dist-backend',
  'dist-backend-manifest',
  'release',
  'release-client',
  'frontend/dist',
  'backend/dist',
];

let removed = 0;
for (const rel of TARGETS) {
  const abs = path.join(ROOT, rel);
  if (fs.existsSync(abs)) {
    console.log(`[clean] 🧹 removing ${rel}`);
    fs.rmSync(abs, { recursive: true, force: true });
    removed += 1;
  } else {
    console.log(`[clean] · ${rel} (already absent)`);
  }
}

console.log(`[clean] ✅ done (${removed} path${removed === 1 ? '' : 's'} removed)`);
