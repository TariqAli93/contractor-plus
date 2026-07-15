/**
 * runtime.js — single source of truth for paths, ports, and service identity.
 *
 * Everything branches on app.isPackaged:
 *   - packaged: the backend lives in resources/backend and runs as the
 *     "ContractorPlusBackend" Windows Service on the fixed loopback port 31734.
 *   - dev: the backend is the compiled repo build, spawned as an Electron child
 *     on port 3000 (matching the Vite proxy), and the renderer is the Vite dev
 *     server on 5173.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';
import fs from 'node:fs';
import * as cfg from './serviceConfigAdapter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SERVICE_NAME = 'ContractorPlusBackend';
export const PROD_PORT = 31734;
export const DEV_PORT = 3000;
export const DEV_RENDERER_URL = 'http://127.0.0.1:5173/';

// Sourced from the shared contract (PROTOCOL_VERSION) via the service-config
// adapter — no longer a duplicated literal.
export const EXPECTED_PROTOCOL = cfg.PROTOCOL_VERSION;

export function isPackaged() {
  return app.isPackaged;
}

export function repoRoot() {
  // scripts -> electron -> frontend -> <repo>
  return path.resolve(__dirname, '..', '..', '..');
}

export function backendDir() {
  return isPackaged()
    ? path.join(process.resourcesPath, 'backend')
    : path.join(repoRoot(), 'backend');
}

/** Packaged SPA the service serves (single origin). Unused in dev (Vite). */
export function frontendDist() {
  return isPackaged()
    ? path.join(process.resourcesPath, 'frontend')
    : path.join(repoRoot(), 'frontend', 'dist');
}

/** Node runtime used to spawn the backend / prisma / bootstrap. */
export function nodeExe() {
  return isPackaged() ? path.join(backendDir(), 'bin', 'node.exe') : process.execPath;
}

/** When using Electron's own binary as `node` (dev), it needs this env flag. */
export function nodeSpawnEnvExtra() {
  return isPackaged() ? {} : { ELECTRON_RUN_AS_NODE: '1' };
}

export function serviceExe() {
  return path.join(backendDir(), `${SERVICE_NAME}.exe`);
}
export function serviceScriptsDir() {
  return path.join(backendDir(), 'service');
}
export function repairScript() {
  return path.join(serviceScriptsDir(), 'repair-service.ps1');
}
export function provisionElevatedScript() {
  return path.join(serviceScriptsDir(), 'provision-elevated.ps1');
}
export function prismaCli() {
  const cli = isPackaged()
    ? path.join(backendDir(), 'node_modules', 'prisma', 'build', 'index.js')
    : path.join(repoRoot(), 'node_modules', 'prisma', 'build', 'index.js');

  if (!fs.existsSync(cli)) {
    throw new Error(`Prisma CLI not found: ${cli}`);
  }

  return cli;
}
export function schemaPath() {
  return path.join(backendDir(), 'prisma', 'schema.prisma');
}
export function bootstrapEntry() {
  return path.join(backendDir(), 'dist', 'setup', 'bootstrap.js');
}
export function serverEntry() {
  return path.join(backendDir(), 'dist', 'server.js');
}

// Canonical home/config/data/logs path resolution lives in the shared contract
// (resolveProgramDataHome + get*Dir). The desktop is never handed
// CONTRACTOR_PLUS_HOME, so it resolves the ProgramData install home here; the
// backend service uses resolveServiceHome (CONTRACTOR_PLUS_HOME, no fallback).
export function programDataHome() {
  return cfg.resolveProgramDataHome();
}
export function configDir() {
  return cfg.getConfigDir(programDataHome());
}
export function configFile() {
  return cfg.getServiceConfigPath(programDataHome());
}
export function dataDir() {
  return cfg.getDataDir(programDataHome());
}
export function logsDir() {
  return cfg.getLogsDir(programDataHome());
}

/**
 * The backend HTTP port the DESKTOP must talk to. service.json is the single
 * source of truth — the backend binds `backendPort` FROM it — so the desktop
 * has to health-check the SAME port, not a hardcoded guess.
 *
 * Why this matters: a packaged install reuses whatever service.json already
 * exists (setup is skipped when it does). If that file was written by a DEV run
 * of the wizard it carries port 3000; the packaged desktop would then poll
 * 31734 forever while the backend listens on 3000, and the window would never
 * load (the exact "works in dev, fails after install" failure).
 *
 * Falls back to the fixed per-mode port ONLY when the config can't be read — a
 * packaged, ACL-locked config, which the packaged wizard wrote with PROD_PORT.
 */
export function backendPort() {
  const resolved = cfg.tryLoadServiceConfig({ home: programDataHome() });
  if (resolved && Number.isInteger(resolved.port) && resolved.port > 0) {
    return resolved.port;
  }
  return isPackaged() ? PROD_PORT : DEV_PORT;
}
export function healthUrl(port = backendPort()) {
  return `http://127.0.0.1:${port}/health`;
}
export function versionUrl(port = backendPort()) {
  return `http://127.0.0.1:${port}/version`;
}

// ── Runtime config — delegated to the shared contract ────────────────────────
//
// service.json (%ProgramData%\ContractorPlus\config\service.json) is the ONE
// place the database connection is defined, in BOTH dev and packaged builds. The
// canonical schema, parser, BOM handling, and DATABASE_URL builder now live in
// packages/shared/src/service/config.ts and are reached through
// serviceConfigAdapter.js — the desktop keeps NO independent copy.
//
// The dev backend therefore NEVER derives DATABASE_URL from backend/.env or a
// hardcoded default — it is built from this file and passed to the child.

/** Canonical Postgres connection-string builder (re-export of the shared one). */
export const buildDatabaseUrl = cfg.buildDatabaseUrl;

/** DATABASE_URL from the provisioned config, or null if not set up / invalid. */
export function runtimeDatabaseUrl() {
  const resolved = cfg.tryLoadServiceConfig({ home: programDataHome() });
  return resolved ? resolved.databaseUrl : null;
}

/** Database name from the provisioned config (for logging + the mismatch guard). */
export function runtimeDatabaseName() {
  const resolved = cfg.tryLoadServiceConfig({ home: programDataHome() });
  return resolved ? resolved.expectedDbName : null;
}

/**
 * Setup completeness — "has the wizard produced a USABLE runtime config?". This
 * is NOT mere presence: a service.json that exists but carries no valid database
 * configuration is NOT complete (it yields no DATABASE_URL, so the backend can
 * never start from it). Requiring a valid database here keeps this decision in
 * lock-step with {@link runtimeDatabaseUrl} and the backend-start gate, so the
 * app can no longer report `setupComplete=true` and then refuse to start with
 * SETUP_NOT_COMPLETE. Equivalent to `Boolean(cfg && cfg.db && cfg.db.url)`.
 * Never throws.
 *
 * @returns {boolean}
 */
export function isSetupComplete() {
  try {
    const presence = cfg.serviceConfigPresence(configFile());

    // Genuinely absent (ENOENT) or unusable I/O error → setup has not run.
    if (presence === 'missing' || presence === 'unreadable') return false;

    // 'locked' = the file EXISTS but the packaged config dir is ACL-locked to
    // SYSTEM+Administrators and this non-elevated client gets EPERM/EACCES. Only
    // a PACKAGED build may trust a config it cannot read — the SYSTEM service
    // owns it and validates service.json (incl. the database) on boot. In DEV
    // there is no such service and the dev child cannot read a locked file, so a
    // locked config is not usable → not complete (send to setup / reset).
    if (presence === 'locked') return isPackaged();

    // 'present' (readable): presence ALONE is not completion. Require a VALID
    // database configuration — a config with no usable db produces no
    // DATABASE_URL, which is exactly the "runtime config has no database" state.
    return runtimeDatabaseUrl() != null;
  } catch {
    return false;
  }
}

/**
 * Validate the provisioned service.json against the SHARED schema — the gate for
 * the "setup complete but config broken" case. Never throws. Returns:
 *   { ok: true,  locked: false }   → present + valid
 *   { ok: true,  locked: true }    → present but ACL-locked (packaged): the client
 *                                    cannot read it; defer to the SYSTEM service,
 *                                    which validates service.json on boot
 *   { ok: false, code, message }   → missing / unreadable / invalid → the caller
 *                                    shows a fatal config error (NO regeneration)
 */
export function diagnoseServiceConfig() {
  let file;
  try {
    file = configFile();
  } catch (err) {
    return { ok: false, locked: false, code: 'SERVICE_HOME_NOT_SET', message: String((err && err.message) || err) };
  }
  // Distinguish missing (ENOENT) from locked (EPERM/EACCES) WITHOUT reading —
  // fs.existsSync would collapse a locked-but-present file to "missing".
  const presence = cfg.serviceConfigPresence(file);
  if (presence === 'missing') {
    return { ok: false, locked: false, code: 'SERVICE_CONFIG_NOT_FOUND', message: `service.json not found at ${file}` };
  }
  if (presence === 'locked') {
    // Exists but ACL-locked: this non-elevated client cannot read it. The SYSTEM
    // service validates service.json on boot — defer to it (treat as ok/locked).
    return { ok: true, locked: true };
  }
  if (presence === 'unreadable') {
    return { ok: false, locked: false, code: 'SERVICE_CONFIG_UNREADABLE', message: `service.json could not be accessed at ${file}` };
  }
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && (err.code === 'EACCES' || err.code === 'EPERM')) return { ok: true, locked: true };
    return { ok: false, locked: false, code: 'SERVICE_CONFIG_UNREADABLE', message: String((err && err.message) || err) };
  }
  try {
    cfg.parseServiceConfig(raw, { configPath: file });
    return { ok: true, locked: false };
  } catch (err) {
    const code = err && err.code ? err.code : 'SERVICE_CONFIG_INVALID_SCHEMA';
    const keyPath = err && err.keyPath ? ` (key: ${err.keyPath})` : '';
    return { ok: false, locked: false, code, message: `${(err && err.message) || 'invalid service.json'}${keyPath}` };
  }
}
