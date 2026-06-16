/**
 * main.cjs — Contractor Plus desktop client entry point.
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
 */
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, protocol, net, dialog } = require('electron');

const rt = require('../scripts/runtime.cjs');
const logger = require('../scripts/logger.cjs');
const serviceController = require('../scripts/serviceController.cjs');
const backendChecker = require('../scripts/backendChecker.cjs');
const backendManager = require('../scripts/backendManager.cjs');
const setup = require('../scripts/setup.cjs');
const versionManager = require('../scripts/versionManager.cjs');
const { setupAutoUpdater } = require('../scripts/autoUpdater.cjs');

const APP_TITLE = 'إدارة المقاولات';
let mainWindow = null;

// Stable ASCII app id so userData resolves to %APPDATA%\ContractorPlus in BOTH
// dev and packaged builds (otherwise dev would use the "frontend" package name).
app.setName('ContractorPlus');

// Must run before app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
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

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    title: APP_TITLE,
    show: false,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.cjs'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  });
  // The SPA sets its own <title>; force the Arabic product name.
  mainWindow.on('page-title-updated', (e) => e.preventDefault());
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  return mainWindow;
}

function getWindow() {
  return mainWindow;
}

function loadWizard() {
  const url = rt.isPackaged() ? 'app://app/index.html' : rt.DEV_RENDERER_URL;
  logger.info('[main] loading wizard: ' + url);
  mainWindow.loadURL(url);
}

function loadApp() {
  const url = rt.isPackaged() ? `http://127.0.0.1:${rt.PROD_PORT}` : rt.DEV_RENDERER_URL;
  logger.info('[main] loading app: ' + url);
  mainWindow.loadURL(url);
}

async function enterAppPhase() {
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

async function boot() {
  registerAppProtocol();
  createMainWindow();

  setup.registerSetupIpc({
    getWindow,
    onComplete: () => {
      enterAppPhase().catch((err) => logger.error('[main] post-setup app phase failed: ' + (err && err.message)));
    },
    logger,
  });

  logger.info(
    `[main] desktop v${versionManager.desktopVersion()} packaged=${rt.isPackaged()} ` +
      `backend=${versionManager.packagedBackendVersion()}`,
  );

  if (!setup.isSetupComplete()) {
    loadWizard();
  } else {
    await enterAppPhase();
  }

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
  app.whenReady().then(boot).catch((err) => {
    logger.error('[main] boot failed: ' + (err && err.stack));
    dialog.showErrorBox('خطأ في بدء التشغيل', String((err && err.message) || err));
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('before-quit', () => backendManager.cleanup());
}
