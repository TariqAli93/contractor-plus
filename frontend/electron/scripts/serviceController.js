/**
 * serviceController.js — thin, never-throwing wrapper around the Windows SCM
 * for the ContractorPlusBackend service.
 *
 * All commands run via execFile (NO shell) with windowsHide, so paths with
 * spaces are passed as discrete argv entries and never re-parsed. BUILTIN\Users
 * are granted start/stop/query at install time, so start/stop/restart work from
 * the non-elevated desktop client; only repair (re-install) elevates via UAC.
 */
import { execFile } from 'node:child_process';
import path from 'node:path';
import * as rt from './runtime.js';

const SYSROOT = process.env.SystemRoot || 'C:\\Windows';
const SC_EXE = path.join(SYSROOT, 'System32', 'sc.exe');
const PS_EXE = path.join(SYSROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

function run(exe, args, timeoutMs = 30_000) {
  return new Promise((resolve) => {
    execFile(exe, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err && typeof err.code === 'number' ? err.code : err ? 1 : 0;
      resolve({ code, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @returns {Promise<'running'|'stopped'|'start_pending'|'stop_pending'|'paused'|'not_installed'|'unknown'>}
 */
export async function queryState() {
  const { code, stdout, stderr } = await run(SC_EXE, ['query', rt.SERVICE_NAME], 15_000);
  const text = `${stdout}\n${stderr}`;
  if (code === 1060 || /1060/.test(text) || /does not exist/i.test(text)) return 'not_installed';
  const m = text.match(/STATE\s+:\s+\d+\s+(\w+)/i);
  if (!m) return code === 0 ? 'unknown' : 'not_installed';
  switch (m[1].toUpperCase()) {
    case 'RUNNING':
      return 'running';
    case 'STOPPED':
      return 'stopped';
    case 'START_PENDING':
      return 'start_pending';
    case 'STOP_PENDING':
      return 'stop_pending';
    case 'PAUSED':
      return 'paused';
    default:
      return 'unknown';
  }
}

export async function isInstalled() {
  return (await queryState()) !== 'not_installed';
}

export async function waitForState(target, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const state = await queryState();
    if (state === target) return true;
    if (state === 'not_installed') return false;
    if (Date.now() > deadline) return false;
    await sleep(500);
  }
}

export async function start({ timeoutMs = 30_000 } = {}) {
  await run(SC_EXE, ['start', rt.SERVICE_NAME], 15_000);
  const ok = await waitForState('running', timeoutMs);
  return { ok, state: await queryState() };
}

export async function stop({ timeoutMs = 25_000 } = {}) {
  // Use the shipped stop-wait.ps1 so we block until STOPPED (sc stop is async).
  const script = path.join(rt.serviceScriptsDir(), 'stop-wait.ps1');
  await run(PS_EXE, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], timeoutMs);
  const ok = (await queryState()) !== 'running';
  return { ok };
}

export async function restart({ timeoutMs = 40_000 } = {}) {
  await stop({ timeoutMs: Math.floor(timeoutMs / 2) });
  return start({ timeoutMs: Math.floor(timeoutMs / 2) });
}

/**
 * Self-elevating (re)install via repair-service.ps1. Shows one UAC prompt.
 * Exit codes: 0 ok, 1223 user declined UAC, other = failure.
 */
export async function repair({ timeoutMs = 180_000 } = {}) {
  const script = rt.repairScript();
  const { code, stdout, stderr } = await run(
    PS_EXE,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
    timeoutMs,
  );
  return { ok: code === 0, code, output: `${stdout}\n${stderr}`.trim() };
}

export async function diagnostics() {
  const state = await queryState();
  return { installed: state !== 'not_installed', state };
}
