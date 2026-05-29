import { spawn, type ChildProcess } from 'node:child_process';
import type { FastifyBaseLogger } from 'fastify';
import { tunnelFilePaths } from './tunnel.fs.js';

const STOP_GRACE_MS = 3_000;

// Module-level singleton — backend runs one tunnel at a time.
let proc: ChildProcess | null = null;

function isAlive(p: ChildProcess | null): p is ChildProcess {
  if (!p || p.pid == null) return false;
  return p.exitCode === null;
}

export function isRunning(): boolean {
  return isAlive(proc);
}

export function startCloudflared(binaryPath: string, log: FastifyBaseLogger): ChildProcess {
  if (isAlive(proc)) {
    log.info('[tunnel] cloudflared already running, skipping spawn');
    return proc;
  }

  const { configFile } = tunnelFilePaths();
  const child = spawn(binaryPath, ['tunnel', '--config', configFile, 'run'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: false,
  });

  child.stdout?.on('data', (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) log.info({ component: 'cloudflared' }, line);
  });
  // cloudflared writes informational logs to stderr; treat as info.
  child.stderr?.on('data', (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) log.info({ component: 'cloudflared' }, line);
  });
  child.on('exit', (code, signal) => {
    log.info(`[tunnel] cloudflared exited code=${code} signal=${signal}`);
    if (proc === child) proc = null;
  });
  child.on('error', (err) => {
    log.error(`[tunnel] cloudflared spawn error: ${err.message}`);
    if (proc === child) proc = null;
  });

  proc = child;
  log.info(`[tunnel] cloudflared spawned pid=${child.pid}`);
  return child;
}

export async function stopCloudflared(log: FastifyBaseLogger): Promise<void> {
  const current = proc;
  if (!isAlive(current)) {
    proc = null;
    return;
  }

  const closed = new Promise<void>((resolve) => {
    current.once('exit', () => resolve());
    current.once('close', () => resolve());
  });

  try {
    if (process.platform === 'win32') {
      // /T = kill the process tree, /F = force. Insurance against
      // cloudflared spawning helpers we don't see.
      spawn('taskkill', ['/pid', String(current.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } else {
      current.kill('SIGTERM');
    }
  } catch (err) {
    log.warn(`[tunnel] kill signal failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  await Promise.race([
    closed,
    new Promise<void>((resolve) => setTimeout(resolve, STOP_GRACE_MS)),
  ]);

  if (isAlive(current)) {
    try {
      current.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }

  proc = null;
  log.info('[tunnel] cloudflared stopped');
}
