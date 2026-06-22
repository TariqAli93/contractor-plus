/**
 * db-ops.js — database provisioning primitives for the setup wizard.
 *
 * IMPORTANT: these run through the BUNDLED Prisma CLI + the compiled backend
 * (both shipped in resources/backend and verified by afterPack), NOT a separate
 * desktop dependency. That keeps the desktop asar free of extra runtime deps
 * (no `pg`) — which is exactly the kind of dependency electron-builder + pnpm's
 * hoisted layout struggles to bundle reliably.
 *
 *   testConnection  — `prisma db execute --url <maintenance> --stdin` (SELECT 1)
 *   createDatabase  — `prisma db execute` → CREATE DATABASE (idempotent)
 *   migrateDeploy   — `prisma migrate deploy`
 *   runBootstrap    — the compiled dist/setup/bootstrap.js, owner via stdin
 *
 * All external processes are spawned via execFile with an explicit argv (no
 * shell), so Windows paths with spaces are safe.
 */
import { execFile } from 'node:child_process';
import * as rt from './runtime.js';

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Re-export the canonical builder (runtime.js) so the wizard's migrate/bootstrap
// URLs and the backend's runtime URL are shaped by the exact same code.
export const buildDatabaseUrl = rt.buildDatabaseUrl;

function runNode(args, { stdinPayload, env, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      rt.nodeExe(),
      args,
      {
        cwd: rt.backendDir(),
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, ...rt.nodeSpawnEnvExtra(), NODE_ENV: 'production', ...env },
      },
      (err, stdout, stderr) => {
        const code = err && typeof err.code === 'number' ? err.code : err ? 1 : 0;
        resolve({ code, stdout: String(stdout || ''), stderr: String(stderr || '') });
      },
    );
    if (stdinPayload != null && child.stdin) {
      child.stdin.write(stdinPayload);
      child.stdin.end();
    }
  });
}

function prismaExec(url, sql, timeoutMs = 20_000) {
  return runNode([rt.prismaCli(), 'db', 'execute', '--url', url, '--stdin'], { stdinPayload: sql, timeoutMs });
}

export async function testConnection({ host, port, user, password }) {
  const url = buildDatabaseUrl({ host, port, database: 'postgres', user, password });
  const r = await prismaExec(url, 'SELECT 1;');
  if (r.code === 0) return { ok: true, message: 'تم الاتصال بقاعدة البيانات بنجاح.' };
  return { ok: false, message: translatePrismaError(`${r.stdout}\n${r.stderr}`) };
}

export async function createDatabase({ host, port, user, password, database }) {
  if (!IDENT_RE.test(database)) {
    return { ok: false, message: `اسم قاعدة بيانات غير صالح: ${database}` };
  }
  const url = buildDatabaseUrl({ host, port, database: 'postgres', user, password });
  // Identifier validated above; CREATE DATABASE cannot be parameterized.
  const r = await prismaExec(url, `CREATE DATABASE "${database}";`);
  if (r.code === 0) return { ok: true, created: true };
  const text = `${r.stdout}\n${r.stderr}`;
  if (/already exists|42P04/i.test(text)) return { ok: true, created: false };
  return { ok: false, message: translatePrismaError(text) };
}

export async function migrateDeploy({ databaseUrl, logger }) {
  const r = await runNode([rt.prismaCli(), 'migrate', 'deploy', '--schema', rt.schemaPath()], {
    env: { DATABASE_URL: databaseUrl },
    timeoutMs: 180_000,
  });
  if (logger) logger.info(`[migrate] exit=${r.code} ${r.stdout.trim()} ${r.stderr.trim()}`);
  if (r.code !== 0) {
    return { ok: false, message: 'تعذّر تجهيز جداول النظام (migrate).', detail: `${r.stdout}\n${r.stderr}`.trim() };
  }
  return { ok: true };
}

export async function runBootstrap({ databaseUrl, owner, logger }) {
  const payload = JSON.stringify({
    username: owner.username,
    pin: owner.pin,
    fullName: owner.fullName || owner.username,
  });
  const r = await runNode([rt.bootstrapEntry()], {
    env: { DATABASE_URL: databaseUrl },
    stdinPayload: payload,
    timeoutMs: 120_000,
  });
  if (logger) logger.info(`[bootstrap] exit=${r.code} ${r.stdout.trim()} ${r.stderr.trim()}`);
  if (r.code !== 0) {
    let message = 'تعذّر إنشاء المستخدم الأول.';
    try {
      const lastLine = (r.stderr || r.stdout).trim().split(/\r?\n/).pop();
      const parsed = JSON.parse(lastLine);
      if (parsed && parsed.error) message = parsed.error;
    } catch {
      /* keep default */
    }
    return { ok: false, message };
  }
  return { ok: true };
}

function translatePrismaError(text) {
  if (/P1000|authentication failed|28P01/i.test(text)) return 'اسم المستخدم أو كلمة المرور غير صحيحة.';
  if (/P1001|Can't reach database server|ECONNREFUSED/i.test(text)) {
    return 'تعذّر الاتصال — تأكد أن خادم PostgreSQL يعمل وأن المضيف/المنفذ صحيح.';
  }
  if (/P1002|timed out|ETIMEDOUT/i.test(text)) return 'انتهت مهلة الاتصال بقاعدة البيانات.';
  if (/P1003|does not exist|3D000/i.test(text)) return 'قاعدة البيانات غير موجودة.';
  const firstLine = String(text).trim().split(/\r?\n/).find((l) => l.trim().length > 0);
  return firstLine || 'خطأ غير معروف في الاتصال بقاعدة البيانات.';
}
