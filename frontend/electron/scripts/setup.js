/**
 * setup.js — implements the `window.desktop` first-run contract the existing
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
import fs from 'node:fs';
import { app, ipcMain } from 'electron';
import * as rt from './runtime.js';
import * as dbOps from './db-ops.js';
import * as provision from './provision.js';
import * as credentials from './credentials.js';
import * as backendChecker from './backendChecker.js';

export const STEP_ORDER = ['test', 'createdb', 'migrate', 'owner', 'finalize'];

// Setup completeness now lives in runtime.js (the single source of truth shared
// with main + backendManager). Re-exported here so existing callers keep working.
export const isSetupComplete = rt.isSetupComplete;

export function defaultDb() {
  return { host: 'localhost', port: 5432, database: 'contractor_plus', adminUser: 'postgres' };
}

export function registerSetupIpc({ getWindow, onComplete, logger }) {
  const emit = (step, status, message) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('desktop:setup:progress', { step, status, message });
    }
  };

  ipcMain.handle('desktop:getState', () => {
    const complete = isSetupComplete();
    logger.info(`[setup] getState: setupComplete=${complete} configFile=${rt.configFile()}`);
    return {
      isDesktop: true,
      setupComplete: complete,
      appVersion: app.getVersion(),
      platform: process.platform,
      defaultDb: defaultDb(),
    };
  });

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
      logger.info(`[setup] finalize/provision → ok=${prov.ok} code=${prov.code ?? '-'}`);
      if (!prov.ok) return fail('finalize', prov.message || 'تعذّر إنهاء الإعداد.');
      // provision.provisionService() persists service.json (the completeness +
      // DATABASE_URL source of truth) in BOTH dev and prod — no separate marker.

      // Packaged: install-service.cmd (run by the elevated step) already waited
      // for the service to reach RUNNING. Confirm the backend actually answers
      // /health before declaring finalize complete, so the wizard never reports
      // success against a service that is RUNNING but not yet serving requests.
      if (rt.isPackaged()) {
        emit('finalize', 'loading', 'في انتظار استجابة الخدمة...');
        const healthy = await backendChecker.waitUntilHealthy({ retries: 30, intervalMs: 1000, logger });
        if (!healthy) {
          return fail('finalize', 'تم تثبيت الخدمة لكنها لم تستجب للفحص الصحي (/health) خلال المهلة المحددة.');
        }
        logger.info('[setup] finalize: backend /health responded OK');
      }
      emit('finalize', 'success');

      // Post-finalize sanity: service.json must now resolve as complete (in
      // packaged builds the config dir is ACL-locked, so this is a 'locked' →
      // present check, NOT a plain existsSync).
      const diag = rt.diagnoseServiceConfig();
      logger.info(
        `[setup] initialize completed. isSetupComplete=${isSetupComplete()} ` +
          `diag={ok:${diag.ok},locked:${diag.locked},code:${diag.code || '-'}}`,
      );
      return { ok: true };
    } catch (err) {
      return fail('finalize', String((err && err.message) || err));
    }
  });

  ipcMain.handle('desktop:setup:complete', async () => {
    // Use the ACL-aware diagnosis, NOT a bare existsSync: right after a successful
    // packaged provision the config dir is locked to SYSTEM+Administrators, so this
    // non-elevated client cannot stat service.json. `locked` still means "setup
    // ran" — treating it as "not complete" caused the success + "الإعداد لم يكتمل
    // بعد" contradiction.
    const diag = rt.diagnoseServiceConfig();
    logger.info(
      `[setup] complete: setupComplete=${isSetupComplete()} ` +
        `diag={ok:${diag.ok},locked:${diag.locked},code:${diag.code || '-'}}`,
    );
    if (!diag.ok && !diag.locked) {
      // service.json is genuinely missing or invalid → setup is truly not complete.
      const error =
        diag.code === 'SERVICE_CONFIG_NOT_FOUND'
          ? 'الإعداد لم يكتمل بعد.'
          : `إعداد الخدمة غير صالح: ${diag.message || diag.code}`;
      logger.error(`[setup] complete refused: ${diag.code} ${diag.message || ''}`);
      return { ok: false, error };
    }
    const appUrl = rt.isPackaged() ? `http://127.0.0.1:${rt.PROD_PORT}` : rt.DEV_RENDERER_URL;
    // Let main switch the window from the wizard to the running app.
    setImmediate(() => onComplete && onComplete(appUrl));
    return { ok: true, appUrl };
  });

  ipcMain.handle('desktop:setup:reset', async () => {
    try {
      // Clear the single source of truth. In packaged builds the config dir is
      // admin-locked, so a full reset is effectively a reinstall — best-effort.
      fs.rmSync(rt.configFile(), { force: true });
    } catch {
      /* ignore */
    }
    return { ok: true };
  });

  ipcMain.handle('desktop:exportTxt', async (_e, cred) => credentials.exportTxt(cred, { win: getWindow() }));
  ipcMain.handle('desktop:exportPdf', async (_e, cred) => credentials.exportPdf(cred, { win: getWindow() }));
}
