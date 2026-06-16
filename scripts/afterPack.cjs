/**
 * scripts/afterPack.cjs
 *
 * electron-builder afterPack hook.
 *
 * Guarantees that the packaged application contains a complete, verified backend
 * tree at:
 *     <appOutDir>/resources/backend
 *
 * We copy ./dist-backend ourselves (rather than via extraResources) because a
 * large node_modules tree copied with a cross-project `from: "../..."` has
 * historically been flaky in electron-builder. Doing it here — after the base
 * app files are laid down, before NSIS packaging — gives a deterministic,
 * auditable copy that fails the build loudly if anything is missing.
 *
 * Contractor Plus runs a TypeScript + Prisma (PostgreSQL) backend as the
 * "ContractorPlusBackend" Windows Service, hosted by a bundled standalone
 * node.exe + WinSW.
 *
 * CommonJS (.cjs) so it runs regardless of the nearest package.json "type".
 */

const fs = require('node:fs');
const path = require('node:path');

// ── Files/dirs that MUST exist after copy for the backend service to run ────
const REQUIRED_AFTER_COPY = [
  // Compiled server + first-run bootstrap (spawned by the desktop wizard)
  'dist/server.js',
  'dist/setup/bootstrap.js',
  'package.json',

  // Bundled standalone Node.js runtime (service host)
  'bin/node.exe',

  // Prisma schema + migrations (consumed by `prisma migrate deploy`)
  'prisma/schema.prisma',
  'prisma/migrations',

  // Production dependencies + generated Prisma client/engine
  'node_modules',
  'node_modules/@prisma/client/package.json',
  'node_modules/.prisma/client',
  'node_modules/prisma/build/index.js',
  'node_modules/fastify/package.json',
  'node_modules/@contractor-plus/shared/package.json',

  // Windows Service host (WinSW)
  'ContractorPlusBackend.exe',
  'ContractorPlusBackend.xml',
  'service/install-service.cmd',
  'service/uninstall-service.cmd',
  'service/start-service.cmd',
  'service/stop-service.cmd',
  'service/restart-service.cmd',
  'service/status-service.cmd',
  'service/verify-version.ps1',
  'service/free-port.ps1',
  'service/stop-wait.ps1',
  'service/repair-service.ps1',
  'service/provision-elevated.ps1',
];

exports.default = async function afterPack(context) {
  const { appOutDir, packager, electronPlatformName } = context;

  // Only repackage the backend for the Windows build (the only service target).
  if (electronPlatformName !== 'win32') {
    console.log(`[afterPack] skipping backend copy for platform=${electronPlatformName}`);
    return;
  }

  // packager.projectDir === <repo>/frontend (electron-builder runs in frontend/)
  const repoRoot = path.resolve(packager.projectDir, '..');
  const distBackend = path.join(repoRoot, 'dist-backend');
  const target = path.join(appOutDir, 'resources', 'backend');

  console.log(`[afterPack] repoRoot    = ${repoRoot}`);
  console.log(`[afterPack] distBackend = ${distBackend}`);
  console.log(`[afterPack] target      = ${target}`);

  // ── Pre-flight: dist-backend must already be built ─────────────────────
  if (!fs.existsSync(distBackend)) {
    throw new Error(
      `[afterPack] dist-backend does not exist at ${distBackend}. ` +
        'Run `pnpm run build:backend-bundle` (node build-backend.js) before packaging.',
    );
  }
  if (!fs.existsSync(path.join(distBackend, 'node_modules'))) {
    throw new Error('[afterPack] dist-backend/node_modules is missing — build-backend.js did not complete.');
  }

  // ── Copy dist-backend -> resources/backend (clean slate) ───────────────
  if (fs.existsSync(target)) {
    console.log('[afterPack] removing stale resources/backend before copy');
    fs.rmSync(target, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });

  console.log('[afterPack] copying dist-backend -> resources/backend ...');
  fs.cpSync(distBackend, target, { recursive: true, dereference: false, verbatimSymlinks: false });

  // ── Post-copy verification ─────────────────────────────────────────────
  const missing = REQUIRED_AFTER_COPY.filter((rel) => !fs.existsSync(path.join(target, rel)));
  if (missing.length > 0) {
    throw new Error(
      '[afterPack] packaged backend is incomplete. Missing:\n  - ' +
        missing.map((m) => `resources/backend/${m}`).join('\n  - '),
    );
  }

  // ── Verify the service descriptor carries ONLY non-secret env vars ─────
  // Contractor Plus injects DB creds + JWT from %ProgramData%\ContractorPlus
  // at runtime (service-config.ts), so the descriptor must set the home dir
  // and NODE_ENV — and must NOT carry secrets.
  const xmlPath = path.join(target, 'ContractorPlusBackend.xml');
  const xmlContent = fs.readFileSync(xmlPath, 'utf8');
  const requiredEnv = ['CONTRACTOR_PLUS_HOME', 'NODE_ENV'];
  const missingEnv = requiredEnv.filter((n) => !new RegExp(`<env\\s+name="${n}"`).test(xmlContent));
  if (missingEnv.length > 0) {
    throw new Error(
      '[afterPack] ContractorPlusBackend.xml is missing required <env> entries:\n  - ' +
        missingEnv.join('\n  - ') +
        '\nUpdate backend/service/ContractorPlusBackend.xml.tmpl and rebuild.',
    );
  }
  if (/<env\s+name="(DATABASE_URL|JWT_ACCESS_SECRET|PG_PASSWORD)"/i.test(xmlContent)) {
    throw new Error(
      '[afterPack] ContractorPlusBackend.xml carries a secret <env> entry. Secrets must ' +
        'live in %ProgramData%\\ContractorPlus\\config\\service.json, never in the descriptor.',
    );
  }
  console.log('[afterPack] ✓ ContractorPlusBackend.xml is secret-free and sets CONTRACTOR_PLUS_HOME');

  // ── Verify .env.production.example shipped (documented override) ───────
  if (!fs.existsSync(path.join(target, '.env.production.example'))) {
    throw new Error('[afterPack] missing resources/backend/.env.production.example — re-run build-backend.js');
  }
  console.log('[afterPack] ✓ .env.production.example present');

  // ── Cross-check: packaged backend version == repo (single source) ──────
  try {
    const packagedPkg = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'));
    const rootPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    if (packagedPkg.version !== rootPkg.version) {
      throw new Error(
        `packaged backend reports v${packagedPkg.version} but the repo is v${rootPkg.version}. ` +
          'Run `node pumb-version.js <x.y.z>` to sync versions, then clean + rebuild.',
      );
    }
    console.log(`[afterPack] ✓ packaged backend version matches the repo (${rootPkg.version})`);
  } catch (err) {
    throw new Error(`[afterPack] version cross-check failed: ${err.message}`);
  }

  console.log('[afterPack] backend packaged and verified (TypeScript + Prisma / PostgreSQL runtime)');
};
