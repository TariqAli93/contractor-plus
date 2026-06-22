/**
 * Live service-mode boot test (Phase 2 regression fix).
 *
 * Boots the REAL compiled backend (dist/server.js) in service mode against a
 * throwaway Postgres database and asserts the full path works:
 *   - migrate-on-boot runs `prisma migrate deploy` with DATABASE_URL injected
 *     into the CLI child (from typed config, not process.env)               → D
 *   - the PrismaClient connects via datasourceUrl (typed config)            → C precursor
 *   - Fastify listens and GET /health responds ok                          → B + C
 *   - DATABASE_URL is NOT in the process environment (service.json wins)
 *
 * Requires a local Postgres reachable at postgres:root@127.0.0.1:5432 and a
 * built backend. Skips (does not fail) if either is unavailable.
 *
 * Run: node --test backend/tests/service-mode-live.test.mjs
 */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const BACKEND = path.join(REPO, 'backend');
const ROOT_NM = path.join(REPO, 'node_modules');
const PRISMA_CLI = path.join(ROOT_NM, 'prisma', 'build', 'index.js');
const SHARED_PKG = path.join(REPO, 'packages', 'shared');
const PG_ADMIN = 'postgresql://postgres:root@127.0.0.1:5432/postgres';
const TEST_DB = 'contractor_plus_p2_live';
const PORT = 31987;

function pgExec(url, sql) {
  execFileSync(process.execPath, [PRISMA_CLI, 'db', 'execute', '--url', url, '--stdin'], {
    input: sql,
    stdio: ['pipe', 'ignore', 'ignore'],
  });
}

function mkJunction(target, link) {
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(target, link, 'junction');
}

/** Remove ONLY the junction link, never its target. */
function rmJunction(link) {
  try {
    fs.rmdirSync(link);
  } catch {
    try {
      fs.unlinkSync(link);
    } catch {
      /* ignore */
    }
  }
}

async function getJson(url, timeoutMs = 3000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal });
    return { ok: res.ok, status: res.status, body: res.ok ? await res.json() : null };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('service-mode boot: migrate-on-boot + Prisma connect + /health (no DATABASE_URL env)', async (t) => {
  if (!fs.existsSync(path.join(BACKEND, 'dist', 'server.js'))) {
    t.skip('backend not built (run `pnpm --filter backend build`)');
    return;
  }
  try {
    pgExec(PG_ADMIN, 'SELECT 1;');
  } catch {
    t.skip('local Postgres (postgres:root@127.0.0.1:5432) not available');
    return;
  }

  const TB = path.join(REPO, '.tmp-p2-bundle');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-live-'));
  let child = null;
  let out = '';

  try {
    // Fresh database.
    pgExec(PG_ADMIN, `DROP DATABASE IF EXISTS "${TEST_DB}";`);
    pgExec(PG_ADMIN, `CREATE DATABASE "${TEST_DB}";`);

    // Temp bundle under the repo (upward resolution reaches root node_modules for
    // fastify/@prisma/client/etc). Provide the two packages that are NOT at root.
    fs.rmSync(TB, { recursive: true, force: true });
    fs.cpSync(path.join(BACKEND, 'dist'), path.join(TB, 'dist'), { recursive: true });
    fs.cpSync(path.join(BACKEND, 'prisma'), path.join(TB, 'prisma'), { recursive: true });
    mkJunction(path.join(ROOT_NM, 'prisma'), path.join(TB, 'node_modules', 'prisma'));
    mkJunction(SHARED_PKG, path.join(TB, 'node_modules', '@contractor-plus', 'shared'));

    // Valid service.json → the test DB. Note: NO DATABASE_URL anywhere in env.
    fs.mkdirSync(path.join(home, 'config'), { recursive: true });
    fs.writeFileSync(
      path.join(home, 'config', 'service.json'),
      JSON.stringify({
        version: 1,
        port: PORT,
        db: { host: '127.0.0.1', port: 5432, database: TEST_DB, user: 'postgres', password: 'root' },
        jwtSecret: 'a'.repeat(64),
      }),
      'utf8',
    );

    const env = { ...process.env };
    delete env.DATABASE_URL; // prove service.json is the only source
    env.NODE_ENV = 'production';
    env.CONTRACTOR_PLUS_HOME = home;

    child = spawn(process.execPath, [path.join(TB, 'dist', 'server.js')], {
      cwd: TB,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (out += d.toString()));

    // Poll /health for up to ~60s (first boot applies all migrations).
    let health = { ok: false };
    for (let i = 0; i < 60 && !health.ok; i++) {
      if (child.exitCode !== null) break;
      health = await getJson(`http://127.0.0.1:${PORT}/health`, 2000);
      if (!health.ok) await sleep(1000);
    }

    assert.ok(health.ok, `/health should respond ok. Server output:\n${out}`); // B + C
    assert.ok(
      health.body && (health.body.status === 'ok' || health.body.status === 'degraded'),
      `/health status should be ok/degraded, got: ${JSON.stringify(health.body)}`,
    );

    // D: migrate-on-boot ran the CLI successfully (DATABASE_URL was injected).
    assert.match(out, /\[migrate-on-boot\] prisma migrate deploy completed/, `migrate-on-boot should complete. Output:\n${out}`);

    // /version handshake works (DB reachable → schema reported).
    const v = await getJson(`http://127.0.0.1:${PORT}/version`, 3000);
    assert.ok(v.ok && v.body && typeof v.body.protocol === 'number', `/version should respond: ${JSON.stringify(v)}`);
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await sleep(500);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    // Drop the test DB (after the server released its connections).
    await sleep(500);
    try {
      pgExec(PG_ADMIN, `DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE);`);
    } catch {
      /* best effort */
    }
    // Remove junction LINKS first (never their targets), then the temp tree.
    rmJunction(path.join(TB, 'node_modules', 'prisma'));
    rmJunction(path.join(TB, 'node_modules', '@contractor-plus', 'shared'));
    fs.rmSync(TB, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
    // Safety: confirm we did not disturb the real packages behind the junctions.
    assert.ok(fs.existsSync(PRISMA_CLI), 'root prisma CLI must survive cleanup');
    assert.ok(fs.existsSync(path.join(SHARED_PKG, 'package.json')), 'shared package must survive cleanup');
  }
});
