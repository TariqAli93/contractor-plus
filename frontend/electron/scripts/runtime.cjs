/**
 * runtime.cjs — single source of truth for paths, ports, and service identity.
 *
 * Everything branches on app.isPackaged:
 *   - packaged: the backend lives in resources/backend and runs as the
 *     "ContractorPlusBackend" Windows Service on the fixed loopback port 31734.
 *   - dev: the backend is the compiled repo build, spawned as an Electron child
 *     on port 3000 (matching the Vite proxy), and the renderer is the Vite dev
 *     server on 5173.
 */
const path = require('node:path');
const { app } = require('electron');

const SERVICE_NAME = 'ContractorPlusBackend';
const PROD_PORT = 31734;
const DEV_PORT = 3000;
const DEV_RENDERER_URL = 'http://127.0.0.1:5173/';

// Mirror of PROTOCOL_VERSION in packages/shared/src/service/protocol.ts.
// Duplicated as a literal because the desktop main is CJS and cannot import the
// ESM shared package at runtime. verify-versions guards against drift.
const EXPECTED_PROTOCOL = 1;

function isPackaged() {
  return app.isPackaged;
}

function repoRoot() {
  // scripts -> electron -> frontend -> <repo>
  return path.resolve(__dirname, '..', '..', '..');
}

function backendDir() {
  return isPackaged()
    ? path.join(process.resourcesPath, 'backend')
    : path.join(repoRoot(), 'backend');
}

/** Packaged SPA the service serves (single origin). Unused in dev (Vite). */
function frontendDist() {
  return isPackaged()
    ? path.join(process.resourcesPath, 'frontend')
    : path.join(repoRoot(), 'frontend', 'dist');
}

/** Node runtime used to spawn the backend / prisma / bootstrap. */
function nodeExe() {
  return isPackaged() ? path.join(backendDir(), 'bin', 'node.exe') : process.execPath;
}

/** When using Electron's own binary as `node` (dev), it needs this env flag. */
function nodeSpawnEnvExtra() {
  return isPackaged() ? {} : { ELECTRON_RUN_AS_NODE: '1' };
}

function serviceExe() {
  return path.join(backendDir(), `${SERVICE_NAME}.exe`);
}
function serviceScriptsDir() {
  return path.join(backendDir(), 'service');
}
function repairScript() {
  return path.join(serviceScriptsDir(), 'repair-service.ps1');
}
function provisionElevatedScript() {
  return path.join(serviceScriptsDir(), 'provision-elevated.ps1');
}
function prismaCli() {
  return path.join(backendDir(), 'node_modules', 'prisma', 'build', 'index.js');
}
function schemaPath() {
  return path.join(backendDir(), 'prisma', 'schema.prisma');
}
function bootstrapEntry() {
  return path.join(backendDir(), 'dist', 'setup', 'bootstrap.js');
}
function serverEntry() {
  return path.join(backendDir(), 'dist', 'server.js');
}

function programDataHome() {
  const base = process.env.ProgramData || 'C:\\ProgramData';
  return path.join(base, 'ContractorPlus');
}
function configDir() {
  return path.join(programDataHome(), 'config');
}
function configFile() {
  return path.join(configDir(), 'service.json');
}
function dataDir() {
  return path.join(programDataHome(), 'data');
}
function logsDir() {
  return path.join(programDataHome(), 'logs');
}

function backendPort() {
  return isPackaged() ? PROD_PORT : DEV_PORT;
}
function healthUrl(port = backendPort()) {
  return `http://127.0.0.1:${port}/health`;
}
function versionUrl(port = backendPort()) {
  return `http://127.0.0.1:${port}/version`;
}

module.exports = {
  SERVICE_NAME,
  PROD_PORT,
  DEV_PORT,
  DEV_RENDERER_URL,
  EXPECTED_PROTOCOL,
  isPackaged,
  repoRoot,
  backendDir,
  frontendDist,
  nodeExe,
  nodeSpawnEnvExtra,
  serviceExe,
  serviceScriptsDir,
  repairScript,
  provisionElevatedScript,
  prismaCli,
  schemaPath,
  bootstrapEntry,
  serverEntry,
  programDataHome,
  configDir,
  configFile,
  dataDir,
  logsDir,
  backendPort,
  healthUrl,
  versionUrl,
};
