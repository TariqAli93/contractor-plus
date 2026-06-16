/**
 * setup.cjs — implements the `window.desktop` first-run contract the existing
 * Vue setup wizard expects (frontend/src/stores/setup.store.ts +
 * frontend/src/types/desktop.d.ts). Channels:
 *
 *   desktop:getState            → { isDesktop, setupComplete, appVersion, platform, defaultDb }
 *   desktop:setup:test          → testConnection(db)
 *   desktop:setup:initialize    → test → createdb → migrate → owner → finalize (+ progress events)
 *   desktop:setup:complete      → confirm + hand the app URL back to main
 *   desktop:setup:reset         → clear the setup marker / config
 *   desktop:exportTxt / :exportPdf → save the owner credentials
 *
 * Progress is streamed on `desktop:setup:progress` so the wizard checklist
 * updates live.
 */
const fs = require('node:fs');
const path = require('node:path');
const { app, ipcMain } = require('electron');
const rt = require('./runtime.cjs');
const dbOps = require('./db-ops.cjs');
const provision = require('./provision.cjs');
const credentials = require('./credentials.cjs');

const STEP_ORDER = ['test', 'createdb', 'migrate', 'owner', 'finalize'];

function devMarker() {
  return path.join(app.getPath('userData'), 'setup-complete.flag');
}

function isSetupComplete() {
  try {
    return rt.isPackaged() ? fs.existsSync(rt.configFile()) : fs.existsSync(devMarker());
  } catch {
    return false;
  }
}

function defaultDb() {
  return { host: 'localhost', port: 5432, database: 'contractor_plus', adminUser: 'postgres' };
}

function registerSetupIpc({ getWindow, onComplete, logger }) {
  const emit = (step, status, message) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('desktop:setup:progress', { step, status, message });
    }
  };

  ipcMain.handle('desktop:getState', () => ({
    isDesktop: true,
    setupComplete: isSetupComplete(),
    appVersion: app.getVersion(),
    platform: process.platform,
    defaultDb: defaultDb(),
  }));

  ipcMain.handle('desktop:setup:test', async (_e, db) => {
    return dbOps.testConnection({
      host: db.host,
      port: Number(db.port),
      user: db.adminUser,
      password: db.adminPassword,
    });
  });

  ipcMain.handle('desktop:setup:initialize', async (_e, req) => {
    const db = req.db;
    const owner = req.owner;
    const adminUrl = dbOps.buildDatabaseUrl({
      host: db.host,
      port: Number(db.port),
      database: db.database,
      user: db.adminUser,
      password: db.adminPassword,
    });

    const fail = (failedStep, message) => {
      emit(failedStep, 'error', message);
      logger.error(`[setup] failed at ${failedStep}: ${message}`);
      return { ok: false, error: message, failedStep };
    };

    try {
      // 1. test
      emit('test', 'loading');
      const test = await dbOps.testConnection({
        host: db.host,
        port: Number(db.port),
        user: db.adminUser,
        password: db.adminPassword,
      });
      if (!test.ok) return fail('test', test.message);
      emit('test', 'success');

      // 2. createdb
      emit('createdb', 'loading');
      const created = await dbOps.createDatabase({
        host: db.host,
        port: Number(db.port),
        user: db.adminUser,
        password: db.adminPassword,
        database: db.database,
      });
      if (!created.ok) return fail('createdb', created.message);
      emit('createdb', 'success');

      // 3. migrate
      emit('migrate', 'loading');
      const migrated = await dbOps.migrateDeploy({ databaseUrl: adminUrl, logger });
      if (!migrated.ok) return fail('migrate', migrated.message);
      emit('migrate', 'success');

      // 4. owner
      emit('owner', 'loading');
      const bootstrapped = await dbOps.runBootstrap({ databaseUrl: adminUrl, owner, logger });
      if (!bootstrapped.ok) return fail('owner', bootstrapped.message);
      emit('owner', 'success');

      // 5. finalize — provision + install the service (prod) or write marker (dev)
      emit('finalize', 'loading');
      const prov = await provision.provisionService({
        db: {
          host: db.host,
          port: Number(db.port),
          database: db.database,
          user: db.adminUser,
          password: db.adminPassword,
        },
        frontendDist: rt.frontendDist(),
        port: rt.backendPort(),
        logger,
      });
      if (!prov.ok) return fail('finalize', prov.message || 'تعذّر إنهاء الإعداد.');
      if (!rt.isPackaged()) {
        try {
          fs.writeFileSync(devMarker(), new Date().toISOString(), 'utf8');
        } catch {
          /* best-effort */
        }
      }
      emit('finalize', 'success');

      logger.info('[setup] initialize completed');
      return { ok: true };
    } catch (err) {
      return fail('finalize', String((err && err.message) || err));
    }
  });

  ipcMain.handle('desktop:setup:complete', async () => {
    if (!isSetupComplete()) {
      return { ok: false, error: 'الإعداد لم يكتمل بعد.' };
    }
    const appUrl = rt.isPackaged() ? `http://127.0.0.1:${rt.PROD_PORT}` : rt.DEV_RENDERER_URL;
    // Let main switch the window from the wizard to the running app.
    setImmediate(() => onComplete && onComplete(appUrl));
    return { ok: true, appUrl };
  });

  ipcMain.handle('desktop:setup:reset', async () => {
    try {
      if (rt.isPackaged()) {
        // Best-effort; the config dir is admin-locked, so a full reset is a
        // reinstall. We clear what we can.
        fs.rmSync(rt.configFile(), { force: true });
      } else {
        fs.rmSync(devMarker(), { force: true });
      }
    } catch {
      /* ignore */
    }
    return { ok: true };
  });

  ipcMain.handle('desktop:exportTxt', async (_e, cred) => credentials.exportTxt(cred, { win: getWindow() }));
  ipcMain.handle('desktop:exportPdf', async (_e, cred) => credentials.exportPdf(cred, { win: getWindow() }));
}

module.exports = { registerSetupIpc, isSetupComplete, defaultDb, STEP_ORDER };
