/**
 * build-backend.js
 *
 * Builds a self-contained backend artifact in ./dist-backend that is later
 * copied verbatim into the packaged Electron app at:
 *   <app>/resources/backend
 *
 * Contractor Plus is a TypeScript + Prisma backend (PostgreSQL). The bundle is
 * assembled deterministically — we do NOT rely on `pnpm deploy` file selection
 * (backend/.gitignore hides dist/, which deploy would then drop). Pipeline:
 *
 *   1. Clean ./dist-backend
 *   2. Assert the TS build + shared build already ran (compiled dist/ present)
 *   3. Copy compiled output, Prisma schema+migrations, and the service scripts
 *   4. Emit a production package.json (prod deps only; workspace dep vendored)
 *   5. `npm install --omit=dev` the production dependencies
 *   6. Vendor the built @contractor-plus/shared into node_modules (workspace:*
 *      is not resolvable by npm in a standalone tree)
 *   7. `prisma generate` so the Prisma client + native query engine ship
 *   8. Bundle the standalone Node.js runtime (bin/node.exe)
 *   9. Bundle the WinSW service host + render the service descriptor
 *
 * On any failure this script exits non-zero so the electron packaging step is
 * never reached with a broken backend.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = __dirname;
const SOURCE_DIR = path.join(ROOT, 'backend');
const SHARED_DIR = path.join(ROOT, 'packages', 'shared');
const DIST_DIR = path.join(ROOT, 'dist-backend');

// ── Windows Service host (WinSW) ───────────────────────────────────────────
const SERVICE_NAME = 'ContractorPlusBackend';
const WINSW_SOURCE = path.join(ROOT, 'tools', 'winsw', 'WinSW-x64.exe');
const NODE_SOURCE = path.join(ROOT, 'tools', 'node', 'node.exe');
const CLOUDFLARED_SOURCE = path.join(ROOT, 'tools', 'cloudflared', 'cloudflared.exe');
const SERVICE_XML_TEMPLATE = path.join(SOURCE_DIR, 'service', `${SERVICE_NAME}.xml.tmpl`);
const SERVICE_EXE_DIST = path.join(DIST_DIR, `${SERVICE_NAME}.exe`);
const SERVICE_XML_DIST = path.join(DIST_DIR, `${SERVICE_NAME}.xml`);
const SERVICE_SCRIPTS_DIST = path.join(DIST_DIR, 'service');

const REQUIRED_SERVICE_SCRIPTS = [
  'install-service.cmd',
  'uninstall-service.cmd',
  'start-service.cmd',
  'stop-service.cmd',
  'restart-service.cmd',
  'status-service.cmd',
  'verify-version.ps1',
  'free-port.ps1',
  'stop-wait.ps1',
  'repair-service.ps1',
  'provision-elevated.ps1',
];

const log = (msg) => console.log(`[build-backend] ${msg}`);
const warn = (msg) => console.warn(`[build-backend] ⚠ ${msg}`);
const fail = (msg) => {
  console.error(`[build-backend] ❌ ${msg}`);
  process.exit(1);
};

function cleanDist() {
  if (fs.existsSync(DIST_DIR)) {
    log('Cleaning dist-backend...');
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(DIST_DIR, { recursive: true });
}

function assertPrebuilt() {
  const backendEntry = path.join(SOURCE_DIR, 'dist', 'server.js');
  const bootstrapEntry = path.join(SOURCE_DIR, 'dist', 'setup', 'bootstrap.js');
  const sharedEntry = path.join(SHARED_DIR, 'dist', 'index.js');
  if (!fs.existsSync(backendEntry)) {
    fail(
      `Compiled backend not found at ${path.relative(ROOT, backendEntry)}.\n` +
        'Run `pnpm run build:shared && pnpm run build:backend` before this script.',
    );
  }
  if (!fs.existsSync(bootstrapEntry)) {
    fail(
      `Compiled first-run bootstrap not found at ${path.relative(ROOT, bootstrapEntry)}.\n` +
        'The desktop setup wizard spawns dist/setup/bootstrap.js — rebuild the backend.',
    );
  }
  if (!fs.existsSync(sharedEntry)) {
    fail(
      `Built @contractor-plus/shared not found at ${path.relative(ROOT, sharedEntry)}.\n` +
        'Run `pnpm run build:shared` before this script.',
    );
  }
}

function copyAppFiles() {
  log('Copying compiled backend + Prisma + service scripts → dist-backend...');

  // Compiled JS (server.js, setup/bootstrap.js, modules, …).
  fs.cpSync(path.join(SOURCE_DIR, 'dist'), path.join(DIST_DIR, 'dist'), {
    recursive: true,
    dereference: false,
  });

  // Prisma schema + migrations + lock — required for `prisma migrate deploy`
  // and `prisma generate` against the packaged bundle.
  fs.cpSync(path.join(SOURCE_DIR, 'prisma'), path.join(DIST_DIR, 'prisma'), {
    recursive: true,
    dereference: false,
    filter: (src) => {
      const rel = path.relative(path.join(SOURCE_DIR, 'prisma'), src).split(path.sep);
      // Drop the dev TS seed scripts — first-run seeding ships as the compiled
      // dist/setup/bootstrap.js instead (spawned by the desktop wizard).
      if (rel[0] === 'seed' || rel[0] === 'seed.ts') return false;
      return true;
    },
  });

  // Windows Service helper scripts.
  fs.cpSync(path.join(SOURCE_DIR, 'service'), SERVICE_SCRIPTS_DIST, {
    recursive: true,
    dereference: false,
  });
}

function writeProductionPackageJson() {
  const srcPkg = JSON.parse(fs.readFileSync(path.join(SOURCE_DIR, 'package.json'), 'utf8'));

  const deps = { ...(srcPkg.dependencies ?? {}) };
  // The workspace package is vendored manually below — npm cannot resolve
  // "workspace:*" in a standalone tree.
  delete deps['@contractor-plus/shared'];

  const prodPkg = {
    name: srcPkg.name ?? 'backend',
    version: srcPkg.version ?? '0.0.0',
    private: true,
    type: 'module',
    main: 'dist/server.js',
    dependencies: deps,
  };

  fs.writeFileSync(
    path.join(DIST_DIR, 'package.json'),
    JSON.stringify(prodPkg, null, 2) + '\n',
    'utf8',
  );
  log(`✓ dist-backend/package.json (v${prodPkg.version})`);
}

function installProductionDeps() {
  log('Installing production dependencies inside dist-backend (npm --omit=dev)...');
  execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], {
    cwd: DIST_DIR,
    stdio: 'inherit',
    shell: process.platform === 'win32', // npm is npm.cmd on Windows
    env: { ...process.env, PRISMA_SKIP_POSTINSTALL_GENERATE: 'true' },
  });

  const nm = path.join(DIST_DIR, 'node_modules');
  if (!fs.existsSync(nm)) fail('npm install completed but dist-backend/node_modules is missing');

  for (const mod of ['fastify', '@prisma/client', 'prisma']) {
    if (!fs.existsSync(path.join(nm, ...mod.split('/'), 'package.json'))) {
      fail(`Required dependency "${mod}" missing after install — check backend/package.json`);
    }
  }
  log('✓ production dependencies installed (fastify, @prisma/client, prisma)');
}

function vendorSharedPackage() {
  log('Vendoring @contractor-plus/shared into dist-backend/node_modules...');
  const target = path.join(DIST_DIR, 'node_modules', '@contractor-plus', 'shared');
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(path.join(SHARED_DIR, 'dist'), path.join(target, 'dist'), { recursive: true });
  fs.copyFileSync(path.join(SHARED_DIR, 'package.json'), path.join(target, 'package.json'));
  log('✓ @contractor-plus/shared vendored (dist + package.json)');
}

function generatePrismaClient() {
  log('Generating Prisma client + native query engine inside dist-backend...');
  const prismaCli = path.join(DIST_DIR, 'node_modules', 'prisma', 'build', 'index.js');
  if (!fs.existsSync(prismaCli)) fail(`prisma CLI not found at ${path.relative(ROOT, prismaCli)}`);

  execFileSync(
    process.execPath,
    [prismaCli, 'generate', '--schema', path.join('prisma', 'schema.prisma')],
    {
      cwd: DIST_DIR,
      stdio: 'inherit',
      env: { ...process.env },
    },
  );

  const generated = path.join(DIST_DIR, 'node_modules', '.prisma', 'client');
  if (!fs.existsSync(generated)) {
    fail('prisma generate ran but node_modules/.prisma/client is missing — client not generated');
  }
  log('✓ Prisma client generated');
}

function writeEnvProductionExample() {
  const target = path.join(DIST_DIR, '.env.production.example');
  const content = `# Contractor Plus backend — production environment template (NO SECRETS).
#
# In packaged production the backend runs as the Windows Service
# "ContractorPlusBackend" and reads its full configuration — including the DB
# password and JWT secret — from:
#   %ProgramData%\\ContractorPlus\\config\\service.json
# which is written (and ACL-locked) by the desktop first-run setup wizard.
# You normally do NOT edit anything here.
#
# This template documents the variables the backend understands if you ever
# need to run it manually (e.g. for diagnostics):

# NODE_ENV=production
# PORT=31734



# JWT signing secret (>= 32 chars). REQUIRED — generate a strong random value:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# JWT_ACCESS_SECRET=replace_me_with_a_strong_random_32_byte_hex_string

# Single-origin SPA + data dir (set automatically by the service in production):
# FRONTEND_DIST=C:\\Program Files\\ContractorPlus\\resources\\frontend
# CONTRACTOR_PLUS_DATA_DIR=C:\\ProgramData\\ContractorPlus\\data
`;
  fs.writeFileSync(target, content, 'utf8');
  log(`✓ ${path.relative(ROOT, target)}`);
}

function bundleNodeRuntime() {
  log('Bundling standalone Node.js runtime (bin/node.exe)...');
  if (!fs.existsSync(NODE_SOURCE)) {
    fail(
      `Node runtime missing: ${path.relative(ROOT, NODE_SOURCE)}\n` +
        'Run `pnpm run fetch:node` to download and verify it, then re-run this build.',
    );
  }
  const binDir = path.join(DIST_DIR, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.copyFileSync(NODE_SOURCE, path.join(binDir, 'node.exe'));
  log('✓ bin/node.exe');
}

function bundleCloudflared() {
  // Optional: the remote-access (tunnel) feature spawns cloudflared. The service
  // resolves it at <bundle>/cloudflared.exe (cwd fallback in cloudflared-path.ts).
  // Ship it when present; the backend degrades gracefully (tunnel disabled) if not.
  if (!fs.existsSync(CLOUDFLARED_SOURCE)) {
    warn(
      'cloudflared.exe not found under tools/cloudflared — remote-access tunnel will be unavailable.',
    );
    return;
  }
  fs.copyFileSync(CLOUDFLARED_SOURCE, path.join(DIST_DIR, 'cloudflared.exe'));
  log('✓ cloudflared.exe (remote-access tunnel)');
}

function bundleServiceHost() {
  log('Bundling Windows Service host (WinSW)...');

  if (!fs.existsSync(WINSW_SOURCE)) {
    fail(
      `WinSW binary missing: ${path.relative(ROOT, WINSW_SOURCE)}\n` +
        'Run `pnpm run fetch:winsw` to download and verify it, then re-run this build.',
    );
  }
  if (!fs.existsSync(SERVICE_XML_TEMPLATE)) {
    fail(`Service descriptor template missing: ${path.relative(ROOT, SERVICE_XML_TEMPLATE)}`);
  }

  // 1. WinSW.exe → dist-backend/ContractorPlusBackend.exe
  fs.copyFileSync(WINSW_SOURCE, SERVICE_EXE_DIST);
  log(`✓ ${path.relative(ROOT, SERVICE_EXE_DIST)}`);

  // 2. Render the XML descriptor with the backend version baked in.
  const backendPkg = JSON.parse(fs.readFileSync(path.join(DIST_DIR, 'package.json'), 'utf8'));
  const tmpl = fs.readFileSync(SERVICE_XML_TEMPLATE, 'utf8');
  const rendered = tmpl.replace(/\$\{BACKEND_VERSION\}/g, backendPkg.version || '0.0.0');
  fs.writeFileSync(SERVICE_XML_DIST, rendered, 'utf8');
  log(`✓ ${path.relative(ROOT, SERVICE_XML_DIST)} (v${backendPkg.version})`);

  // 3. Verify the service scripts shipped, then drop the template from the dist.
  if (!fs.existsSync(SERVICE_SCRIPTS_DIST)) {
    fail(`Service scripts directory missing in dist-backend: ${SERVICE_SCRIPTS_DIST}`);
  }
  for (const required of REQUIRED_SERVICE_SCRIPTS) {
    const abs = path.join(SERVICE_SCRIPTS_DIST, required);
    if (!fs.existsSync(abs)) fail(`Missing service script: service/${required}`);
  }
  const distTmpl = path.join(SERVICE_SCRIPTS_DIST, `${SERVICE_NAME}.xml.tmpl`);
  if (fs.existsSync(distTmpl)) fs.rmSync(distTmpl, { force: true });

  log('✓ service host bundled');
}

function verifyBundle() {
  const required = [
    'dist/server.js',
    'dist/setup/bootstrap.js',
    'package.json',
    'bin/node.exe',
    'prisma/schema.prisma',
    'prisma/migrations',
    'node_modules/@prisma/client/package.json',
    'node_modules/.prisma/client',
    'node_modules/prisma/build/index.js',
    'node_modules/fastify/package.json',
    'node_modules/@contractor-plus/shared/package.json',
    `${SERVICE_NAME}.exe`,
    `${SERVICE_NAME}.xml`,
  ];
  const missing = required.filter((rel) => !fs.existsSync(path.join(DIST_DIR, rel)));
  if (missing.length > 0) {
    fail('dist-backend is incomplete. Missing:\n  - ' + missing.join('\n  - '));
  }
  log('✓ bundle verified');
}

function main() {
  log(`Platform: ${process.platform}`);
  log(`Source:   ${SOURCE_DIR}`);
  log(`Dist:     ${DIST_DIR}`);

  if (process.platform !== 'win32') {
    warn('Building on a non-Windows host — the bundled node.exe / WinSW and the');
    warn('Prisma query engine target Windows. Run the real build on Windows.');
  }

  cleanDist();
  assertPrebuilt();
  copyAppFiles();
  writeProductionPackageJson();
  installProductionDeps();
  vendorSharedPackage();
  generatePrismaClient();
  writeEnvProductionExample();
  bundleNodeRuntime();
  bundleCloudflared();
  bundleServiceHost();
  verifyBundle();

  log('✅ Backend build complete — dist-backend is ready for packaging');
}

main();
