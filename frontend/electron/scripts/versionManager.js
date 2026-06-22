/**
 * versionManager.js — read the packaged backend + desktop versions for logging
 * and diagnostics.
 *
 * NOTE: schema migrations after an app update are applied by the BACKEND itself
 * on service boot (backend/src/setup/migrate-on-boot.ts runs `prisma migrate
 * deploy` when CONTRACTOR_PLUS_HOME is set) — because only the service account
 * can read the ACL-locked DB credentials. The desktop client only runs the
 * first-install migration during the setup wizard (when it still holds the
 * admin creds the operator just entered).
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import * as rt from './runtime.js';

export function packagedBackendVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(rt.backendDir(), 'package.json'), 'utf8'));
    return pkg.version || null;
  } catch {
    return null;
  }
}

export function desktopVersion() {
  return app.getVersion();
}
