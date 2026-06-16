/**
 * versionManager.cjs — read the packaged backend + desktop versions for logging
 * and diagnostics.
 *
 * NOTE: schema migrations after an app update are applied by the BACKEND itself
 * on service boot (backend/src/setup/migrate-on-boot.ts runs `prisma migrate
 * deploy` when CONTRACTOR_PLUS_HOME is set) — because only the service account
 * can read the ACL-locked DB credentials. The desktop client only runs the
 * first-install migration during the setup wizard (when it still holds the
 * admin creds the operator just entered).
 */
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const rt = require('./runtime.cjs');

function packagedBackendVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(rt.backendDir(), 'package.json'), 'utf8'));
    return pkg.version || null;
  } catch {
    return null;
  }
}

function desktopVersion() {
  return app.getVersion();
}

module.exports = { packagedBackendVersion, desktopVersion };
