/**
 * main.js — Contractor Plus desktop client entry point.
 *
 * Two phases, branching on app.isPackaged and setup state:
 *
 *   WIZARD phase (setup incomplete): the SPA is loaded WITHOUT a backend
 *     (packaged: via the app:// protocol so vue-router history works; dev: Vite)
 *     and all of first-run setup runs over IPC (window.desktop.*) — test DB,
 *     create DB, migrate, create owner, then provision + install the Windows
 *     Service.
 *
 *   APP phase (setup complete): ensure the ContractorPlusBackend service is
 *     installed + running + protocol-compatible (self-heal / elevated repair on
 *     failure), then load the running service URL (single origin — the service
 *     serves the SPA + API). In dev the backend is a spawned child on :3000 and
 *     the renderer is Vite on :5173.
 *
 * The user is never left at a blank screen: every failure path shows a native
 * dialog with retry / repair / quit.
 *
 * Loaded as ESM (frontend/package.json has "type": "module"). All static
 * imports resolve before this module body runs, so protocol.registerSchemes-
 * AsPrivileged still executes before app `ready`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, ipcMain, Menu, protocol, net, dialog, screen } from 'electron';

import * as rt from '../scripts/runtime.js';
import * as logger from '../scripts/logger.js';
import * as serviceController from '../scripts/serviceController.js';
import * as backendChecker from '../scripts/backendChecker.js';
import * as backendManager from '../scripts/backendManager.js';
import * as setup from '../scripts/setup.js';
import * as versionManager from '../scripts/versionManager.js';
import { setupAutoUpdater } from '../scripts/autoUpdater.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Global safety net ────────────────────────────────────────────────────────
// In DEV a crash prints to the terminal; in a PACKAGED build there is no console,
// so anything uncaught vanishes and the process lingers in Task Manager with no
// window. Capture EVERYTHING to the on-disk log (<userData>/logs) so a
// production failure is diagnosable, and never let a stray rejection be silent.
function stringifyErr(v) {
  if (v instanceof Error) return v.stack || v.message;
  try {
    return typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
}
process.on('uncaughtException', (err) => {
  try {
    logger.error('[main] uncaughtException: ' + stringifyErr(err));
  } catch {
    /* logging must never throw */
  }
});
process.on('unhandledRejection', (reason) => {
  try {
    logger.error('[main] unhandledRejection: ' + stringifyErr(reason));
  } catch {
    /* ignore */
  }
});
app.on('child-process-gone', (_event, details) =>
  logger.error('[main] child-process-gone: ' + stringifyErr(details)),
);
app.on('render-process-gone', (_event, _wc, details) =>
  logger.error('[main] render-process-gone: ' + stringifyErr(details)),
);

const APP_TITLE = 'إدارة المقاولات';
let mainWindow = null;

// Stable ASCII app id so userData resolves to %APPDATA%\ContractorPlus in BOTH
// dev and packaged builds (otherwise dev would use the "frontend" package name).
app.setName('ContractorPlus');

// Must run before app is ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

function registerAppProtocol() {
  protocol.handle('app', async (request) => {
    try {
      const url = new URL(request.url);
      let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      if (!rel) rel = 'index.html';
      const root = path.resolve(rt.frontendDist());
      let filePath = path.resolve(path.join(root, rel));
      if (!filePath.startsWith(root)) filePath = path.join(root, 'index.html'); // traversal guard
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(root, 'index.html'); // SPA history fallback
      }
      return net.fetch(pathToFileURL(filePath).toString());
    } catch (err) {
      logger.error('[app://] ' + (err && err.message));
      return new Response('Not found', { status: 404 });
    }
  });
}

// The renderer draws its own title bar, but the caption buttons stay native:
// `titleBarOverlay` keeps Windows 11 Snap Layouts (the flyout on maximize-hover)
// and puts the buttons on the correct side for an RTL app — the two things a
// hand-drawn frame always gets wrong. Linux has no overlay support, so there we
// keep the OS frame rather than ship a window nobody can move.
const OVERLAY_HEIGHT = 32;
const OVERLAY_SUPPORTED = process.platform === 'win32' || process.platform === 'darwin';

// Mirrors the one approved desktop surface in frontend/src/assets/styles/main.css.
const OVERLAY_OPTIONS = { color: '#FFFFFF', symbolColor: '#1A202C', height: OVERLAY_HEIGHT };

// ── Never leave the app invisible in Task Manager ────────────────────────────
// The window is created hidden (show:false) to avoid a white flash and only
// revealed once content paints (ready-to-show). If the initial load ever fails
// — a broken app:// resolve, the service origin being down, a renderer crash —
// ready-to-show never fires and, without this, the process would run with no
// window and no error. showMainWindow() is idempotent and reached from FOUR
// independent paths (ready-to-show, did-finish-load, a hard timeout, and the
// failure page) so the window is guaranteed to appear.
let windowShown = false;
let failurePageShown = false;
const WINDOW_SHOW_FALLBACK_MS = 8000;

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed() || windowShown) return;
  windowShown = true;
  try {
    ensureWindowOnScreen();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    logger.info('[main] window shown');
  } catch (err) {
    logger.error('[main] show failed: ' + stringifyErr(err));
  }
}

/** Guard against a window positioned on a display that is no longer connected. */
function ensureWindowOnScreen() {
  try {
    const b = mainWindow.getBounds();
    const onSomeDisplay = screen.getAllDisplays().some((d) => {
      const wa = d.workArea;
      return (
        b.x < wa.x + wa.width && b.x + b.width > wa.x && b.y < wa.y + wa.height && b.y + b.height > wa.y
      );
    });
    if (!onSomeDisplay) mainWindow.center();
  } catch {
    /* best-effort */
  }
}

function dataUrl(html) {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

/** A self-contained in-window page (no external assets — safe over data:). */
function shellPage({ message, spinner = false, error = false }) {
  const accent = error ? '#C0392B' : '#1A202C';
  const spin = spinner
    ? `<div style="width:34px;height:34px;border:3px solid #d7dde3;border-top-color:#1A202C;border-radius:50%;margin:0 auto 18px;animation:s 0.9s linear infinite"></div>`
    : `<div style="font-size:34px;margin-bottom:10px">⚠️</div>`;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<style>@keyframes s{to{transform:rotate(360deg)}}
html,body{margin:0;height:100%}
body{background:#F3F5F7;color:${accent};display:flex;align-items:center;justify-content:center;
font-family:'Segoe UI',Tahoma,sans-serif;text-align:center;padding:24px;box-sizing:border-box}
.msg{max-width:520px;font-size:15px;line-height:1.9;word-break:break-word}</style></head>
<body><div><div>${spin}</div><div class="msg">${message}</div></div></body></html>`;
}

function showLoadingPage(message) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow
    .loadURL(dataUrl(shellPage({ message, spinner: true })))
    .catch((err) => logger.warn('[main] loading page: ' + stringifyErr(err)));
}

/**
 * Render a VISIBLE failure page inside the window (a dialog on a hidden parent
 * can go unnoticed). Points the user at the on-disk log and reveals the window.
 */
function showLoadFailurePage(detail) {
  if (!mainWindow || mainWindow.isDestroyed() || failurePageShown) return;
  failurePageShown = true;
  let logPath = '';
  try {
    logPath = logger.logDir();
  } catch {
    /* ignore */
  }
  const message =
    'تعذّر تحميل واجهة التطبيق.<br><br>' +
    `<span style="color:#5a6470">${detail}</span>` +
    (logPath ? `<br><br><small style="color:#8a94a0">سجل التشخيص:<br>${logPath}</small>` : '');
  mainWindow.loadURL(dataUrl(shellPage({ message, error: true }))).catch(() => {});
  showMainWindow();
}

function safeCall(fn) {
  try {
    return fn();
  } catch (err) {
    return 'ERR:' + (err && err.message);
  }
}

/**
 * One-line, content-free snapshot of every path/flag that differs between DEV
 * and a packaged install — the fastest way to spot a missing renderer, an
 * unresolved preload, or a wrong resourcesPath from the user's log alone.
 */
function logStartupDiagnostics() {
  const preloadPath = path.join(__dirname, '..', 'preload', 'preload.mjs');
  const indexHtml = safeCall(() => path.join(rt.frontendDist(), 'index.html'));
  logger.info(
    '[diag] ' +
      JSON.stringify({
        isPackaged: safeCall(() => rt.isPackaged()),
        platform: process.platform,
        arch: process.arch,
        execPath: process.execPath,
        cwd: safeCall(() => process.cwd()),
        resourcesPath: process.resourcesPath,
        appPath: safeCall(() => app.getAppPath()),
        userData: safeCall(() => app.getPath('userData')),
        dirname: __dirname,
        preload: preloadPath,
        preloadExists: fs.existsSync(preloadPath),
        frontendDist: safeCall(() => rt.frontendDist()),
        indexHtml,
        indexExists: typeof indexHtml === 'string' && fs.existsSync(indexHtml),
        // The port the desktop will health-check — resolved from service.json,
        // NOT assumed. A value that isn't PROD_PORT on a packaged build means a
        // stale/foreign config (e.g. a dev-written service.json) is in use.
        backendPort: safeCall(() => rt.backendPort()),
        backendDir: safeCall(() => rt.backendDir()),
        serviceExe: safeCall(() => rt.serviceExe()),
        serviceExeExists: safeCall(() => fs.existsSync(rt.serviceExe())),
        configFile: safeCall(() => rt.configFile()),
        logDir: safeCall(() => logger.logDir()),
      }),
  );
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    title: APP_TITLE,
    show: false,
    backgroundColor: '#F3F5F7',
    ...(OVERLAY_SUPPORTED
      ? { titleBarStyle: 'hidden', titleBarOverlay: OVERLAY_OPTIONS }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.mjs'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  });
  // With a hidden title bar, Electron's default menu would render *inside* the
  // client area, directly on top of the menu row the renderer draws. Remove it.
  // Its accelerators go with it, so re-bind the two that matter for development.
  Menu.setApplicationMenu(null);
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (rt.isPackaged() || input.type !== 'keyDown') return;
    const devtools = input.key === 'F12' || (input.control && input.shift && input.key === 'I');
    const reload = input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r');
    if (devtools) mainWindow.webContents.toggleDevTools();
    else if (reload) mainWindow.webContents.reload();
  });

  // The SPA sets its own <title>; force the Arabic product name.
  mainWindow.on('page-title-updated', (e) => e.preventDefault());
  mainWindow.once('ready-to-show', showMainWindow);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Renderer lifecycle → the on-disk log, and a guaranteed reveal.
  const wc = mainWindow.webContents;
  wc.on('did-start-loading', () => logger.info('[renderer] did-start-loading'));
  wc.on('dom-ready', () => logger.info('[renderer] dom-ready'));
  wc.on('did-finish-load', () => {
    logger.info('[renderer] did-finish-load');
    showMainWindow(); // belt to ready-to-show
  });
  wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    // -3 = ERR_ABORTED: a superseded navigation (e.g. loading page → real URL). Benign.
    if (errorCode === -3 || !isMainFrame) return;
    if (validatedURL && validatedURL.startsWith('data:')) return; // our own diagnostic page
    logger.error(
      `[renderer] did-fail-load code=${errorCode} desc=${errorDescription} url=${validatedURL}`,
    );
    showLoadFailurePage(`${errorDescription} (${errorCode})<br>${validatedURL}`);
  });
  wc.on('render-process-gone', (_event, details) => {
    logger.error('[renderer] render-process-gone: ' + stringifyErr(details));
    showLoadFailurePage('توقّف عارض الواجهة: ' + (details && details.reason));
  });
  wc.on('preload-error', (_event, preloadPath, error) => {
    logger.error(`[preload] error at ${preloadPath}: ` + stringifyErr(error));
  });
  mainWindow.on('unresponsive', () => logger.error('[main] window unresponsive'));
  mainWindow.on('responsive', () => logger.info('[main] window responsive again'));

  // Last-resort reveal: if nothing has painted (a hard load failure that somehow
  // fired no event), show the window anyway so the app is never a headless process.
  setTimeout(showMainWindow, WINDOW_SHOW_FALLBACK_MS);

  return mainWindow;
}

function getWindow() {
  return mainWindow;
}

function loadWizard() {
  const url = rt.isPackaged() ? 'app://app/index.html' : rt.DEV_RENDERER_URL;
  logger.info('[main] loading wizard: ' + url);
  // Return the promise so boot() can await it; swallow benign navigation
  // rejections (e.g. ERR_ABORTED) so they never bubble to the boot error box.
  return mainWindow.loadURL(url).catch((err) => logger.warn('[main] wizard load: ' + (err && err.message)));
}

function loadApp() {
  // Single origin: the backend service serves the SPA + API, so the window must
  // load the port the backend ACTUALLY bound — which is service.json's `port`
  // (rt.backendPort()), the SAME value the health check + version gate already
  // used to declare the backend ready. Using a hardcoded PROD_PORT here is the
  // one place that could drift from that source of truth: if service.json
  // carries any other port (e.g. a dev-written :3000 inherited by a packaged
  // install), the backend listens there, health passes there, and this window
  // would load an empty PROD_PORT → ERR_CONNECTION_REFUSED even though every log
  // says the backend is up. Read the port from the one source, never assume it.
  const url = rt.isPackaged() ? `http://127.0.0.1:${rt.backendPort()}` : rt.DEV_RENDERER_URL;
  logger.info('[main] loading app: ' + url);
  return mainWindow.loadURL(url).catch((err) => logger.warn('[main] app load: ' + (err && err.message)));
}

async function enterAppPhase() {
  // Hard gate (defence in depth — boot() already branches on this). If setup is
  // not complete we must NEVER start the backend, wait on health, run the
  // version check, or repair/start the Windows service — all of those assume a
  // provisioned `contractor_plus` database. Show the wizard instead.
  if (!rt.isSetupComplete()) {
    logger.warn('[main] enterAppPhase invoked before setup complete — loading wizard');
    loadWizard();
    return;
  }

  logger.info('[main] entering app phase');

  if (rt.isPackaged()) {
    const diag = await serviceController.diagnostics();
    logger.info(`[main] service diag installed=${diag.installed} state=${diag.state}`);
    if (!diag.installed) {
      const ok = await recoverMissingService();
      if (!ok) return; // wizard reloaded, user quit, or repair failed (dialog shown)
    }
  }

  const result = await backendChecker.ensureBackendReady({ manager: backendManager, logger });
  logger.info(`[main] ensureBackendReady → ${result.status}`);

  if (result.status === 'ready') {
    loadApp();
    return;
  }
  await handleBackendFailure(result);
}

async function recoverMissingService() {
  const hasConfig = fs.existsSync(rt.configFile());
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: hasConfig ? ['إصلاح الخدمة الآن', 'إغلاق'] : ['إعادة الإعداد', 'إغلاق'],
    defaultId: 0,
    cancelId: 1,
    title: 'خدمة الخادم غير مثبتة',
    message: 'لم يتم العثور على خدمة الخادم الخلفي (ContractorPlusBackend).',
    detail: hasConfig
      ? 'سنعيد تثبيت الخدمة الآن (سيُطلب رفع الصلاحيات مرة واحدة).'
      : 'يبدو أن الإعداد لم يكتمل — سيتم فتح معالج الإعداد.',
  });
  if (response === 1) {
    app.quit();
    return false;
  }
  if (!hasConfig) {
    loadWizard();
    return false;
  }
  const repaired = await serviceController.repair({ timeoutMs: 180_000 });
  logger.info(`[main] repair ok=${repaired.ok} code=${repaired.code}`);
  if (!repaired.ok) {
    await dialog.showMessageBox(mainWindow, {
      type: 'error',
      buttons: ['إغلاق'],
      title: 'تعذّر إصلاح الخدمة',
      message: 'لم نتمكن من تثبيت خدمة الخادم.',
      detail: repaired.output || `exit ${repaired.code}`,
    });
    return false;
  }
  return true;
}

async function handleBackendFailure(result) {
  const isMismatch = result.status === 'version-mismatch';
  const buttons = rt.isPackaged()
    ? ['إعادة المحاولة', 'إصلاح (رفع صلاحيات)', 'إغلاق']
    : ['إعادة المحاولة', 'إغلاق'];
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'error',
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
    title: isMismatch ? 'عدم تطابق إصدار الخادم' : 'تعذّر تشغيل الخادم',
    message: isMismatch
      ? 'إصدار الخدمة الخلفية لا يطابق هذا التطبيق.'
      : 'تعذّر الاتصال بالخدمة الخلفية.',
    detail: (result.error || '') + '\n\nيمكنك إعادة المحاولة أو إصلاح الخدمة.',
  });

  const quitIndex = buttons.length - 1;
  if (response === quitIndex) {
    app.quit();
    return;
  }
  if (rt.isPackaged()) {
    if (response === 1) await serviceController.repair({ timeoutMs: 180_000 });
    else await serviceController.restart({ timeoutMs: 40_000 });
  }
  await enterAppPhase(); // retry
}

/**
 * Setup is marked complete but service.json is present-and-invalid (readable).
 * Show a clear FATAL config error — never silently regenerate. The user may
 * explicitly re-run setup (which rewrites it) or quit.
 */
async function showFatalConfigError(diag) {
  if (!mainWindow) return;
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'error',
    buttons: ['إعادة الإعداد', 'إغلاق'],
    defaultId: 1,
    cancelId: 1,
    title: 'إعداد الخدمة غير صالح',
    message: 'ملف إعدادات الخدمة (service.json) موجود لكنه غير صالح.',
    detail:
      `${diag.code || ''}${diag.message ? `\n${diag.message}` : ''}` +
      '\n\nلن تتم إعادة إنشائه تلقائيًا. يمكنك إعادة تشغيل معالج الإعداد لإعادة كتابته، أو إغلاق التطبيق.',
  });
  if (response === 0) {
    // Explicit, user-initiated re-run of setup — NOT a silent regeneration.
    loadWizard();
    return;
  }
  app.quit();
}

async function boot() {
  logStartupDiagnostics();
  registerAppProtocol();
  createMainWindow();
  // Reveal the window immediately with a loading state — the backend handshake
  // and service checks below can take many seconds, and the user must never
  // stare at an empty desktop. The real content replaces this in-place.
  showLoadingPage('جارٍ تشغيل التطبيق، يرجى الانتظار…');

  setup.registerSetupIpc({
    getWindow,
    onComplete: () => {
      enterAppPhase().catch((err) =>
        logger.error('[main] post-setup app phase failed: ' + (err && err.message)),
      );
    },
    logger,
  });
  logger.info(
    `[main] desktop v${versionManager.desktopVersion()} packaged=${rt.isPackaged()} ` +
      `backend=${versionManager.packagedBackendVersion()}`,
  );

  const setupComplete = rt.isSetupComplete();

  logger.info(`[main] setupComplete=${setupComplete} configFile=${rt.configFile?.()}`);

  if (!setupComplete) {
    // The runtime config is absent or carries no valid database — do NOT enter
    // the app phase, call ensureBackendReady, or try to start the backend. Open
    // the setup wizard instead (backend stays down).
    logger.info('[main] setup incomplete — database config missing');
    logger.info('[main] opening setup');
    await loadWizard();
    return;
  }

  // Setup is marked complete (service.json present). Validate it via the shared
  // schema BEFORE starting anything. If it is readable but invalid/corrupt, show
  // a FATAL config error — do NOT silently regenerate it or fall back to a guess.
  // (Packaged: the config dir is ACL-locked and unreadable by this non-elevated
  // client → diag.locked → defer to the SYSTEM service, which validates on boot.)
  const diag = rt.diagnoseServiceConfig();
  if (!diag.ok && !diag.locked) {
    logger.error(`[main] service.json invalid: ${diag.code} ${diag.message || ''}`);
    await showFatalConfigError(diag);
    return;
  }

  logger.info('[main] setup complete — entering app phase');
  await enterAppPhase();

  if (rt.isPackaged()) {
    const updater = setupAutoUpdater({ logger });
    setTimeout(() => updater.check(), 8000);
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app
    .whenReady()
    .then(boot)
    .catch((err) => {
      logger.error('[main] boot failed: ' + (err && err.stack));
      dialog.showErrorBox('خطأ في بدء التشغيل', String((err && err.message) || err));
    });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('before-quit', () => backendManager.cleanup());
}
