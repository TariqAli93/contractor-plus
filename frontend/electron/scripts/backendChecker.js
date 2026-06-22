/**
 * backendChecker.js — health + version handshake against the local backend.
 *
 * The version gate compares the backend's reported `protocol` (GET /version)
 * against EXPECTED_PROTOCOL. A mismatch means a stale service is answering after
 * an update (or vice-versa) and the UI must NOT load against it.
 */
import * as rt from './runtime.js';

async function fetchJson(url, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return { ok: false, reason: `http-${res.status}` };
    const body = await res.json();
    if (!body || typeof body !== 'object') return { ok: false, reason: 'not-object' };
    return { ok: true, body };
  } catch (err) {
    return { ok: false, reason: err && err.name === 'AbortError' ? 'timeout' : `fetch-error` };
  }
}

export async function checkHealth(port = rt.backendPort()) {
  const r = await fetchJson(rt.healthUrl(port), 4000);
  if (!r.ok) return { ok: false, reason: r.reason };
  const status = r.body.status;
  return { ok: status === 'ok' || status === 'healthy' || status === 'degraded', status };
}

export async function checkVersion(port = rt.backendPort()) {
  const r = await fetchJson(rt.versionUrl(port), 4000);
  if (!r.ok) return { ok: false, reason: r.reason };
  return { ok: true, app: r.body.app, schema: r.body.schema, protocol: r.body.protocol };
}

export function protocolOk(protocol) {
  return protocol === rt.EXPECTED_PROTOCOL;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function waitUntilHealthy({ port = rt.backendPort(), retries = 60, intervalMs = 1000, logger } = {}) {
  for (let i = 0; i < retries; i++) {
    const h = await checkHealth(port);
    if (h.ok) return true;
    if (logger && i % 5 === 0) logger.info(`[backend] waiting for health (${i + 1}/${retries})`);
    await sleep(intervalMs);
  }
  return false;
}

/**
 * Orchestrate: ensure the backend is up (asking the manager to start it if not)
 * and that its protocol matches. Returns:
 *   { status: 'ready' | 'down' | 'version-mismatch' | 'error', version, error }
 */
export async function ensureBackendReady({ manager, logger } = {}) {
  const port = rt.backendPort();

  // 1. Already healthy?
  let healthy = (await checkHealth(port)).ok;

  // 2. Not healthy → ask the manager to start it, then poll.
  if (!healthy) {
    if (logger) logger.info('[backend] not healthy — requesting start');
    const started = await manager.start();
    // The manager refuses to start the backend before setup is complete. Do NOT
    // wait on health or run the version check in that case — surface it so the
    // caller shows the wizard instead of hanging for the full health timeout.
    if (started && started.skipped) {
      if (logger) logger.warn(`[backend] start skipped: ${started.reason}`);
      return { status: 'down', error: `start skipped: ${started.reason}` };
    }
    if (!started.ok && logger) logger.warn(`[backend] start reported not-ok: ${started.error || started.state || ''}`);
    healthy = await waitUntilHealthy({ port, logger });
  }

  if (!healthy) {
    return { status: 'down', error: 'backend did not become healthy in time' };
  }

  // 3. Version / protocol gate.
  const v = await checkVersion(port);
  if (!v.ok) {
    // Healthy but /version unreachable — treat as ready-ish (DB may be warming).
    if (logger) logger.warn(`[backend] /version unavailable (${v.reason}) — proceeding`);
    return { status: 'ready', version: null };
  }
  if (!protocolOk(v.protocol)) {
    return {
      status: 'version-mismatch',
      version: v,
      error: `protocol ${v.protocol} != expected ${rt.EXPECTED_PROTOCOL}`,
    };
  }
  return { status: 'ready', version: v };
}
