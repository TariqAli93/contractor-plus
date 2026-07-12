/**
 * Unit tests for the shared service-config loader.
 *
 * Run with the repo's tsx (NodeNext): from the repo root
 *   pnpm exec tsx --test packages/shared/src/service/config.test.ts
 *
 * These cover the Phase-1 acceptance cases A–F at the loader level (no DB, no
 * Fastify): missing file, invalid JSON, invalid schema with exact key path, env
 * non-override, and a valid on-disk-shaped config.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ConfigError,
  buildDatabaseUrl,
  getConfigDir,
  getDataDir,
  getLogsDir,
  getServiceConfigPath,
  loadServiceConfig,
  parseServiceConfig,
  resolveProgramDataHome,
  resolveServiceHome,
  serviceConfigPresence,
} from './config.js';

/** Create a temp home dir; optionally write config/service.json with `body`. */
function makeHome(body?: string): string {
  const home = mkdtempSync(path.join(os.tmpdir(), 'cp-cfg-'));
  if (body !== undefined) {
    mkdirSync(path.join(home, 'config'), { recursive: true });
    writeFileSync(getServiceConfigPath(home), body, 'utf8');
  }
  return home;
}

function cleanup(home: string): void {
  rmSync(home, { recursive: true, force: true });
}

/** A valid config in the REAL on-disk shape (top-level `port`, `db.database`). */
function validBody(overrides: Record<string, unknown> = {}): string {
  const cfg = {
    version: 1,
    port: 31734,
    frontendDist: 'C:\\Program Files\\ContractorPlus\\resources\\frontend',
    db: { host: '127.0.0.1', port: 5432, database: 'contractor_plus', user: 'postgres', password: 'p@ss/w:rd' },
    jwtSecret: 'a'.repeat(64),
    ...overrides,
  };
  return JSON.stringify(cfg, null, 2);
}

test('A: missing service.json → SERVICE_CONFIG_NOT_FOUND', () => {
  const home = makeHome(); // no file written
  try {
    assert.throws(
      () => loadServiceConfig({ home }),
      (err: unknown) => err instanceof ConfigError && err.code === 'SERVICE_CONFIG_NOT_FOUND',
    );
  } finally {
    cleanup(home);
  }
});

test('B: invalid JSON → SERVICE_CONFIG_INVALID_JSON', () => {
  const home = makeHome('{ this is not json ]');
  try {
    assert.throws(
      () => loadServiceConfig({ home }),
      (err: unknown) => err instanceof ConfigError && err.code === 'SERVICE_CONFIG_INVALID_JSON',
    );
  } finally {
    cleanup(home);
  }
});

test('C: missing db.password → SERVICE_CONFIG_INVALID_SCHEMA with keyPath db.password', () => {
  const body = JSON.stringify({
    version: 1,
    port: 31734,
    db: { host: '127.0.0.1', port: 5432, database: 'contractor_plus', user: 'postgres' },
    jwtSecret: 'a'.repeat(64),
  });
  const home = makeHome(body);
  try {
    assert.throws(
      () => loadServiceConfig({ home }),
      (err: unknown) =>
        err instanceof ConfigError &&
        err.code === 'SERVICE_CONFIG_INVALID_SCHEMA' &&
        err.keyPath === 'db.password',
    );
  } finally {
    cleanup(home);
  }
});

test('D: process.env.DATABASE_URL does NOT override service.json', () => {
  const home = makeHome(validBody());
  const prev = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://evil:evil@10.0.0.1:5432/attacker_db?schema=public';
  try {
    const resolved = loadServiceConfig({ home });
    assert.equal(resolved.expectedDbName, 'contractor_plus');
    assert.ok(resolved.databaseUrl.includes('/contractor_plus?schema=public'));
    assert.ok(!resolved.databaseUrl.includes('attacker_db'));
  } finally {
    if (prev === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prev;
    cleanup(home);
  }
});

test('F: valid on-disk config resolves databaseUrl + port from service.json', () => {
  const home = makeHome(validBody());
  try {
    const r = loadServiceConfig({ home });
    assert.equal(r.port, 31734);
    assert.equal(r.expectedDbName, 'contractor_plus');
    assert.equal(r.jwtSecret, 'a'.repeat(64));
    assert.equal(r.configPath, getServiceConfigPath(home));
    assert.equal(r.dataDir, path.join(home, 'data'));
    // password p@ss/w:rd must be URL-encoded.
    assert.ok(r.databaseUrl.startsWith('postgresql://postgres:p%40ss%2Fw%3Ard@127.0.0.1:5432/contractor_plus'));
    // corsOrigin derives from port when absent.
    assert.equal(r.corsOrigin, 'http://127.0.0.1:31734');
  } finally {
    cleanup(home);
  }
});

test('accepts the alias shape (backendPort + db.name)', () => {
  const body = JSON.stringify({
    appName: 'Contractor Plus',
    version: '1.0.0',
    protocolVersion: '1',
    backendPort: 31734,
    db: { host: '127.0.0.1', port: 5432, name: 'contractor_plus', user: 'postgres', password: 'pw' },
    jwtSecret: 'b'.repeat(40),
    corsOrigin: 'http://127.0.0.1:31734',
  });
  const home = makeHome(body);
  try {
    const r = loadServiceConfig({ home });
    assert.equal(r.port, 31734);
    assert.equal(r.expectedDbName, 'contractor_plus');
    assert.equal(r.corsOrigin, 'http://127.0.0.1:31734');
  } finally {
    cleanup(home);
  }
});

test('jwtSecret shorter than 32 chars → SERVICE_CONFIG_INVALID_SCHEMA keyPath jwtSecret', () => {
  const home = makeHome(validBody({ jwtSecret: 'tooshort' }));
  try {
    assert.throws(
      () => loadServiceConfig({ home }),
      (err: unknown) =>
        err instanceof ConfigError &&
        err.code === 'SERVICE_CONFIG_INVALID_SCHEMA' &&
        err.keyPath === 'jwtSecret',
    );
  } finally {
    cleanup(home);
  }
});

test('resolveServiceHome: missing CONTRACTOR_PLUS_HOME → SERVICE_HOME_NOT_SET', () => {
  assert.throws(
    () => resolveServiceHome({} as NodeJS.ProcessEnv),
    (err: unknown) => err instanceof ConfigError && err.code === 'SERVICE_HOME_NOT_SET',
  );
  assert.equal(
    resolveServiceHome({ CONTRACTOR_PLUS_HOME: 'C:\\ProgramData\\ContractorPlus' } as NodeJS.ProcessEnv),
    'C:\\ProgramData\\ContractorPlus',
  );
});

test('buildDatabaseUrl encodes credentials', () => {
  const url = buildDatabaseUrl({ host: 'h', port: 5432, database: 'd', user: 'u@x', password: 'p:w/d' });
  assert.equal(url, 'postgresql://u%40x:p%3Aw%2Fd@h:5432/d?schema=public');
});

test('serviceConfigPresence: present vs missing', () => {
  const home = makeHome(validBody());
  try {
    assert.equal(serviceConfigPresence(getServiceConfigPath(home)), 'present');
    assert.equal(serviceConfigPresence(path.join(home, 'config', 'nope.json')), 'missing');
  } finally {
    cleanup(home);
  }
});

// ── ai block (compat-first: entirely optional) ───────────────────────────────

test('ai: absent block → resolved.ai is undefined and nothing else changes', () => {
  const home = makeHome(validBody());
  try {
    const r = loadServiceConfig({ home });
    assert.equal(r.ai, undefined);
  } finally {
    cleanup(home);
  }
});

test('ai: present block passes through all fields', () => {
  const home = makeHome(
    validBody({
      ai: {
        openrouterApiKey: 'sk-or-test',
        openrouterBaseUrl: 'https://openrouter.ai/api/v1',
        modelDefault: 'anthropic/claude-sonnet-4.6',
        modelHeavy: 'anthropic/claude-opus-4.8',
        appUrl: 'https://contractor.example',
        appTitle: 'Contractor Plus',
        requestTimeoutMs: 30000,
        monthlyTokenBudget: 2000000,
      },
    }),
  );
  try {
    const r = loadServiceConfig({ home });
    assert.equal(r.ai?.openrouterApiKey, 'sk-or-test');
    assert.equal(r.ai?.modelDefault, 'anthropic/claude-sonnet-4.6');
    assert.equal(r.ai?.modelHeavy, 'anthropic/claude-opus-4.8');
    assert.equal(r.ai?.requestTimeoutMs, 30000);
    assert.equal(r.ai?.monthlyTokenBudget, 2000000);
  } finally {
    cleanup(home);
  }
});

test('ai: keyless block stays valid (AI simply disabled) — partial fields ok', () => {
  const home = makeHome(validBody({ ai: { modelDefault: 'anthropic/claude-sonnet-4.6' } }));
  try {
    const r = loadServiceConfig({ home });
    assert.equal(r.ai?.openrouterApiKey, undefined);
    assert.equal(r.ai?.modelDefault, 'anthropic/claude-sonnet-4.6');
  } finally {
    cleanup(home);
  }
});

test('ai: non-integer requestTimeoutMs → SERVICE_CONFIG_INVALID_SCHEMA keyPath ai.requestTimeoutMs', () => {
  const home = makeHome(validBody({ ai: { requestTimeoutMs: 'soon' } }));
  try {
    assert.throws(
      () => loadServiceConfig({ home }),
      (err: unknown) =>
        err instanceof ConfigError &&
        err.code === 'SERVICE_CONFIG_INVALID_SCHEMA' &&
        err.keyPath === 'ai.requestTimeoutMs',
    );
  } finally {
    cleanup(home);
  }
});

// Regression for the "setup success + الإعداد لم يكتمل بعد" contradiction: a file
// that EXISTS but whose dir is ACL-locked to SYSTEM+Administrators (exactly what
// the packaged provision does) must report 'locked', NEVER 'missing'. A
// non-elevated client previously got existsSync=false → "setup not complete".
// Windows-only (uses icacls); skipped elsewhere.
test('serviceConfigPresence: ACL-locked file reports locked, not missing', { skip: process.platform !== 'win32' }, () => {
  const home = makeHome(validBody());
  const configDir = path.join(home, 'config');
  const file = getServiceConfigPath(home);
  try {
    execFileSync(
      'icacls',
      [configDir, '/inheritance:r', '/grant:r', 'SYSTEM:(OI)(CI)F', 'Administrators:(OI)(CI)F'],
      { stdio: 'ignore' },
    );
    const presence = serviceConfigPresence(file);
    // Elevated runners keep read access → 'present'; non-elevated → 'locked'.
    // The bug was 'missing'; assert it is NOT that.
    assert.notEqual(presence, 'missing');
    assert.ok(presence === 'locked' || presence === 'present', `expected locked/present, got ${presence}`);
  } finally {
    try {
      execFileSync('icacls', [configDir, '/reset', '/T', '/C'], { stdio: 'ignore' });
    } catch {
      /* may be locked when non-elevated */
    }
    try {
      cleanup(home);
    } catch {
      /* locked — leave the temp dir */
    }
  }
});

test('parseServiceConfig validates text and strips a leading BOM', () => {
  const valid = validBody();
  const cfg = parseServiceConfig(valid);
  assert.equal(cfg.backendPort, 31734);
  assert.equal(cfg.db.database, 'contractor_plus');
  // BOM-prefixed text still parses.
  const cfgBom = parseServiceConfig(String.fromCharCode(0xfeff) + valid);
  assert.equal(cfgBom.backendPort, 31734);
});

test('parseServiceConfig: invalid JSON → SERVICE_CONFIG_INVALID_JSON', () => {
  assert.throws(
    () => parseServiceConfig('{ nope ]'),
    (err: unknown) => err instanceof ConfigError && err.code === 'SERVICE_CONFIG_INVALID_JSON',
  );
});

test('resolveProgramDataHome derives the desktop install home', () => {
  assert.equal(
    resolveProgramDataHome({ ProgramData: 'C:\\ProgramData' } as NodeJS.ProcessEnv),
    path.join('C:\\ProgramData', 'ContractorPlus'),
  );
  // Falls back only for the desktop resolver (ProgramData is virtually always set on Windows).
  assert.equal(resolveProgramDataHome({} as NodeJS.ProcessEnv), path.join('C:\\ProgramData', 'ContractorPlus'));
});

test('path helpers are consistent for a given home', () => {
  const home = 'C:\\ProgramData\\ContractorPlus';
  assert.equal(getConfigDir(home), path.join(home, 'config'));
  assert.equal(getDataDir(home), path.join(home, 'data'));
  assert.equal(getLogsDir(home), path.join(home, 'logs'));
  assert.equal(getServiceConfigPath(home), path.join(home, 'config', 'service.json'));
});
