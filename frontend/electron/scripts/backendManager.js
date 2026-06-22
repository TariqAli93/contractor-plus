/**
 * backendManager.js — owns "make the backend run", abstracting the two modes:
 *
 *   packaged → the ContractorPlusBackend Windows Service (via serviceController).
 *              The SCM owns the process lifecycle; the app only asks it to start.
 *   dev      → a child process (the compiled backend on the Vite-proxy port),
 *              spawned with the bundled/Electron node so `pnpm electron:dev` is
 *              self-contained. The app owns and tears down this child.
 */
import { spawn } from 'node:child_process';
import * as rt from './runtime.js';
import * as logger from './logger.js';
import * as serviceController from './serviceController.js';

let child = null;

// Hard gate: never start the backend (dev child OR Windows service) before the
// setup wizard has created the database + written the runtime config. Starting
// server.js against the not-yet-created `contractor_plus` DB is exactly what
// throws PrismaClientInitializationError P1003 — and in production the service
// would fail to boot for the same reason. Callers get an explicit, non-throwing
// skip result so they can show the wizard instead of waiting on health.
const SETUP_NOT_COMPLETE = { ok: false, skipped: true, reason: 'SETUP_NOT_COMPLETE' };

export async function start() {
  if (!rt.isSetupComplete()) return SETUP_NOT_COMPLETE;

  if (rt.isPackaged()) {
    const res = await serviceController.start({ timeoutMs: 30_000 });
    return { ok: res.ok, state: res.state };
  }
  return startDevBackend();
}

function startDevBackend() {
  if (!rt.isSetupComplete()) return SETUP_NOT_COMPLETE;
  if (child && !child.killed) return { ok: true, pid: child.pid };

  // DATABASE_URL comes ONLY from the wizard-provisioned service.json — never
  // from backend/.env, .env.local, .env.production, or a hardcoded default.
  const databaseUrl = rt.runtimeDatabaseUrl();
  const dbName = rt.runtimeDatabaseName();
  if (!databaseUrl) {
    // Config present-but-without a db (corrupt) — refuse rather than let the
    // backend fall back to backend/.env (the exact bug we are fixing).
    logger.error('[backend] runtime config has no database — refusing to start dev backend');
    return SETUP_NOT_COMPLETE;
  }

  logger.info('[backend] DATABASE_URL source = runtime config');
  logger.info(`[backend] database = ${dbName}`);

  child = spawn(rt.nodeExe(), [rt.serverEntry()], {
    cwd: rt.backendDir(),
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      ...rt.nodeSpawnEnvExtra(),
      NODE_ENV: 'development',
      PORT: String(rt.DEV_PORT),
      // Explicit → wins over backend/.env (dotenv does not override an already
      // set var). CONTRACTOR_PLUS_EXPECTED_DB arms the backend mismatch guard.
      DATABASE_URL: databaseUrl,
      CONTRACTOR_PLUS_EXPECTED_DB: dbName,
    },
  });
  child.on('exit', () => {
    child = null;
  });
  return { ok: true, pid: child.pid };
}

export async function stop() {
  if (rt.isPackaged()) {
    // The service is meant to outlive the client; only stop it on demand.
    return serviceController.stop({ timeoutMs: 20_000 });
  }
  return stopDevChild();
}

function stopDevChild() {
  if (child && !child.killed) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  child = null;
  return { ok: true };
}

export async function restart() {
  if (rt.isPackaged()) return serviceController.restart();
  stopDevChild();
  return startDevBackend();
}

/** Tear down only the dev child on app quit; the service outlives the client. */
export function cleanup() {
  if (!rt.isPackaged()) stopDevChild();
}
