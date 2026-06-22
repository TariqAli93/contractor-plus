/**
 * Integration tests for the production boot path (Phase 1).
 *
 * Spawns the COMPILED backend entry (dist/server.js) in service/production mode
 * and asserts the "service.json is the only source of truth" contract end to
 * end: configuration failures exit(1) BEFORE Prisma/Fastify, and neither a
 * planted `.env` nor a `DATABASE_URL` in the environment can bypass service.json.
 *
 * Prereq: `pnpm --filter @contractor-plus/shared build && pnpm --filter backend build`
 * Run:    node --test backend/tests/boot-config.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(__dirname, '..');
const SERVER_ENTRY = path.join(BACKEND_DIR, 'dist', 'server.js');

/** Env without the keys our tests want to control, so the host shell can't leak them in. */
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  delete env.CONTRACTOR_PLUS_HOME;
  delete env.DATABASE_URL;
  delete env.CONTRACTOR_PLUS_EXPECTED_DB;
  delete env.FRONTEND_DIST;
  return { ...env, ...extra };
}

/** Spawn the built server; returns { status, out } with stdout+stderr combined. */
function boot({ env, cwd }) {
  const res = spawnSync(process.execPath, [SERVER_ENTRY], {
    env,
    cwd,
    encoding: 'utf8',
    timeout: 25_000,
    windowsHide: true,
  });
  return { status: res.status, out: `${res.stdout || ''}\n${res.stderr || ''}` };
}

test('A+D+E: missing service.json fails fast, ignoring a planted .env and env DATABASE_URL', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'cp-home-')); // no config/service.json
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'cp-cwd-'));
  // A .env that the OLD code would have loaded via dotenv and let win.
  writeFileSync(
    path.join(cwd, '.env'),
    'DATABASE_URL=postgresql://planted:planted@127.0.0.1:5432/planted_db?schema=public\n' +
      `JWT_ACCESS_SECRET=${'z'.repeat(64)}\n`,
    'utf8',
  );
  try {
    const { status, out } = boot({
      cwd,
      env: cleanEnv({
        NODE_ENV: 'production',
        CONTRACTOR_PLUS_HOME: home,
        // An env DATABASE_URL must NOT bypass the missing service.json anymore.
        DATABASE_URL: 'postgresql://planted:planted@127.0.0.1:5432/planted_db?schema=public',
        JWT_ACCESS_SECRET: 'z'.repeat(64),
      }),
    });
    assert.notEqual(status, 0, 'process should exit non-zero');
    assert.match(out, /SERVICE_CONFIG_NOT_FOUND/, 'should report the missing-config code');
    assert.doesNotMatch(out, /planted_db/, 'must not use the planted .env / env DATABASE_URL');
    assert.doesNotMatch(out, /listening|Server listening|:31734/i, 'must exit before Fastify listens');
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('H: production mode without CONTRACTOR_PLUS_HOME fails clearly (SERVICE_HOME_NOT_SET)', () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'cp-cwd-'));
  try {
    const { status, out } = boot({
      cwd,
      env: cleanEnv({ NODE_ENV: 'production', JWT_ACCESS_SECRET: 'z'.repeat(64) }),
    });
    assert.notEqual(status, 0, 'process should exit non-zero');
    assert.match(out, /SERVICE_HOME_NOT_SET/, 'should fail loudly when the service home is unset');
    assert.doesNotMatch(out, /listening|Server listening/i, 'must exit before Fastify listens');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('B: invalid JSON in service.json fails fast (SERVICE_CONFIG_INVALID_JSON)', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'cp-home-'));
  mkdirSync(path.join(home, 'config'), { recursive: true });
  writeFileSync(path.join(home, 'config', 'service.json'), '{ broken ]', 'utf8');
  try {
    const { status, out } = boot({
      cwd: home,
      env: cleanEnv({ NODE_ENV: 'production', CONTRACTOR_PLUS_HOME: home }),
    });
    assert.notEqual(status, 0);
    assert.match(out, /SERVICE_CONFIG_INVALID_JSON/);
    assert.doesNotMatch(out, /listening|Server listening/i);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('C: service.json missing db.password fails fast with the exact key path', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'cp-home-'));
  mkdirSync(path.join(home, 'config'), { recursive: true });
  writeFileSync(
    path.join(home, 'config', 'service.json'),
    JSON.stringify({
      version: 1,
      port: 31734,
      db: { host: '127.0.0.1', port: 5432, database: 'contractor_plus', user: 'postgres' },
      jwtSecret: 'a'.repeat(64),
    }),
    'utf8',
  );
  try {
    const { status, out } = boot({
      cwd: home,
      env: cleanEnv({ NODE_ENV: 'production', CONTRACTOR_PLUS_HOME: home }),
    });
    assert.notEqual(status, 0);
    assert.match(out, /SERVICE_CONFIG_INVALID_SCHEMA/);
    assert.match(out, /db\.password/);
    assert.doesNotMatch(out, /listening|Server listening/i);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
