/**
 * backendManager.cjs — owns "make the backend run", abstracting the two modes:
 *
 *   packaged → the ContractorPlusBackend Windows Service (via serviceController).
 *              The SCM owns the process lifecycle; the app only asks it to start.
 *   dev      → a child process (the compiled backend on the Vite-proxy port),
 *              spawned with the bundled/Electron node so `pnpm electron:dev` is
 *              self-contained. The app owns and tears down this child.
 */
const { spawn } = require('node:child_process');
const rt = require('./runtime.cjs');
const serviceController = require('./serviceController.cjs');

let child = null;

async function start() {
  if (rt.isPackaged()) {
    const res = await serviceController.start({ timeoutMs: 30_000 });
    return { ok: res.ok, state: res.state };
  }
  return startDevChild();
}

function startDevChild() {
  if (child && !child.killed) return { ok: true, pid: child.pid };
  child = spawn(rt.nodeExe(), [rt.serverEntry()], {
    cwd: rt.backendDir(),
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      ...rt.nodeSpawnEnvExtra(),
      NODE_ENV: 'development',
      PORT: String(rt.DEV_PORT),
    },
  });
  child.on('exit', () => {
    child = null;
  });
  return { ok: true, pid: child.pid };
}

async function stop() {
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

async function restart() {
  if (rt.isPackaged()) return serviceController.restart();
  stopDevChild();
  return startDevChild();
}

/** Tear down only the dev child on app quit; the service outlives the client. */
function cleanup() {
  if (!rt.isPackaged()) stopDevChild();
}

module.exports = { start, stop, restart, cleanup };
