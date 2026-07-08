/**
 * Tests for the Electron → shared service-config bridge.
 *
 * Proves the desktop main consumes the SAME shared contract as the backend
 * (objective 1): the adapter resolves `@contractor-plus/shared/service-config`
 * from the Electron scripts location, exposes the canonical loader/parser/URL
 * builder, and has no independent schema.
 *
 * Run: node --test frontend/electron/scripts/serviceConfigAdapter.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import * as adapter from './serviceConfigAdapter.js';

function makeHome(body) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'cp-adapter-'));
  if (body !== undefined) {
    mkdirSync(path.join(home, 'config'), { recursive: true });
    writeFileSync(adapter.getServiceConfigPath(home), body, 'utf8');
  }
  return home;
}

test('adapter exposes the shared contract (one source, no local schema)', () => {
  for (const fn of [
    'loadServiceConfig',
    'parseServiceConfig',
    'buildDatabaseUrl',
    'tryLoadServiceConfig',
    'resolveProgramDataHome',
    'getServiceConfigPath',
    'getConfigDir',
    'getDataDir',
  ]) {
    assert.equal(typeof adapter[fn], 'function', `${fn} should be a function`);
  }
  assert.equal(typeof adapter.PROTOCOL_VERSION, 'number');
  assert.equal(typeof adapter.ConfigError, 'function');
});

test('buildDatabaseUrl is the canonical shared builder', () => {
  const url = adapter.buildDatabaseUrl({ host: 'h', port: 5432, database: 'd', user: 'u@x', password: 'p/w' });
  assert.equal(url, 'postgresql://u%40x:p%2Fw@h:5432/d?schema=public');
});

test('valid service.json loads through the shared contract', () => {
  const home = makeHome(
    JSON.stringify({
      version: 1,
      port: 31734,
      db: { host: '127.0.0.1', port: 5432, database: 'contractor_plus', user: 'postgres', password: 'pw' },
      jwtSecret: 'a'.repeat(40),
    }),
  );
  try {
    const r = adapter.loadServiceConfig({ home });
    assert.equal(r.port, 31734);
    assert.equal(r.expectedDbName, 'contractor_plus');
    assert.ok(r.databaseUrl.includes('/contractor_plus?schema=public'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('invalid service.json → tryLoad null + parse throws coded error', () => {
  const home = makeHome('{ not json ]');
  try {
    assert.equal(adapter.tryLoadServiceConfig({ home }), null);
    assert.throws(
      () => adapter.parseServiceConfig('{ not json ]'),
      (e) => e instanceof adapter.ConfigError && e.code === 'SERVICE_CONFIG_INVALID_JSON',
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('provision writer config shape validates against the shared schema (canonical keys)', () => {
  // Mirror of the object provision.js builds (on-disk keys: top-level `port`, `db.database`).
  const config = {
    version: 1,
    db: { host: 'localhost', port: 5432, database: 'contractor_plus', user: 'postgres', password: 'secret' },
    jwtSecret: 'a'.repeat(64),
    port: 31734,
    frontendDist: 'C:/x/frontend',
  };
  const parsed = adapter.parseServiceConfig(JSON.stringify(config));
  assert.equal(parsed.backendPort, 31734);
  assert.equal(parsed.db.database, 'contractor_plus');
});

test('resolveProgramDataHome derives the desktop install home', () => {
  const home = adapter.resolveProgramDataHome({ ProgramData: 'C:\\ProgramData' });
  assert.equal(home, path.join('C:\\ProgramData', 'ContractorPlus'));
  assert.equal(adapter.getServiceConfigPath(home), path.join(home, 'config', 'service.json'));
});

test('serviceConfigPresence + isSetupComplete decision (present requires a valid database)', () => {
  const home = makeHome(
    JSON.stringify({
      version: 1,
      port: 31734,
      db: { host: '127.0.0.1', port: 5432, database: 'd', user: 'u', password: 'p' },
      jwtSecret: 'a'.repeat(40),
    }),
  );
  // Mirror of runtime.js isSetupComplete. Presence alone is NOT completion: a
  // readable ('present') config counts only when it yields a valid database
  // (tryLoadServiceConfig !== null). 'locked' defers to a packaged SYSTEM
  // service (packaged=true) but is not usable in dev (packaged=false). 'missing'
  // is never complete.
  // Mirrors runtime.js runtimeDatabaseUrl, which always resolves via { home }.
  const isComplete = (presence, h, packaged) => {
    if (presence === 'missing' || presence === 'unreadable') return false;
    if (presence === 'locked') return packaged;
    return adapter.tryLoadServiceConfig({ home: h }) != null;
  };
  const cfgPath = adapter.getServiceConfigPath(home);
  try {
    assert.equal(adapter.serviceConfigPresence(cfgPath), 'present');
    assert.equal(adapter.serviceConfigPresence(path.join(home, 'config', 'nope.json')), 'missing');
    // present + valid db → complete
    assert.equal(isComplete('present', home, false), true);
    // locked → complete only in a packaged build (SYSTEM service owns/validates it)
    assert.equal(isComplete('locked', home, true), true);
    assert.equal(isComplete('locked', home, false), false);
    assert.equal(isComplete('missing', home, false), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('isSetupComplete decision: present config WITHOUT a database is not complete', () => {
  // Schema-valid-looking JSON but no db block → yields no DATABASE_URL. This is the
  // "runtime config has no database" state that must NOT count as setup-complete.
  const home = makeHome(JSON.stringify({ version: 1, port: 31734, jwtSecret: 'a'.repeat(40) }));
  const cfgPath = adapter.getServiceConfigPath(home);
  try {
    assert.equal(adapter.serviceConfigPresence(cfgPath), 'present');
    // Resolves via { home } (as the real code does) → ConfigError → null → not complete.
    assert.equal(adapter.tryLoadServiceConfig({ home }), null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
