/**
 * autoUpdater.js — application auto-update via electron-updater.
 *
 * Best-effort: if no publish feed is configured (no app-update.yml shipped), the
 * checks no-op rather than crash. The important production guarantee — that the
 * backend service survives an update and its schema is migrated — is handled
 * elsewhere: the NSIS customUnInstall PRESERVES the service registration on
 * ${isUpdated}, customInstall refreshes + restarts it, and the backend runs
 * `prisma migrate deploy` on boot (migrate-on-boot.ts). After quitAndInstall the
 * app relaunches and main re-verifies the service before loading the UI.
 *
 * electron-updater is a CommonJS package, so it is pulled in via a lazy
 * `await import()` (inside check()) rather than a static `import`. That keeps
 * the original graceful-degradation try/catch AND avoids top-level `await` in
 * the main module graph — which would delay protocol.registerSchemesAsPrivileged
 * past the `ready` event under Electron's ESM loader.
 */
import { dialog } from 'electron';

export function setupAutoUpdater({ logger } = {}) {
  let autoUpdater = null;
  let initialized = false;

  async function init() {
    if (initialized) return autoUpdater;
    initialized = true;
    try {
      const mod = await import('electron-updater');
      // CJS interop: the package's exports object is on `default`.
      autoUpdater = (mod.default ?? mod).autoUpdater ?? null;
    } catch {
      autoUpdater = null;
    }
    if (!autoUpdater) {
      if (logger) logger.warn('[updater] electron-updater not available — skipping');
      return null;
    }

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = false;
    if (logger) autoUpdater.logger = logger;

    autoUpdater.on('error', (err) => logger && logger.warn(`[updater] ${err && err.message}`));

    autoUpdater.on('update-available', async (info) => {
      if (logger) logger.info(`[updater] update available: ${info && info.version}`);
      const { response } = await dialog.showMessageBox({
        type: 'info',
        buttons: ['تحديث الآن', 'لاحقاً'],
        defaultId: 0,
        cancelId: 1,
        title: 'تحديث متوفّر',
        message: `يتوفّر إصدار جديد (${info && info.version}).`,
        detail: 'سيتم تنزيل التحديث ثم إعادة تشغيل التطبيق. لن تتأثر الخدمة الخلفية ولا بياناتك.',
      });
      if (response === 0) {
        try {
          await autoUpdater.downloadUpdate();
        } catch (err) {
          if (logger) logger.warn(`[updater] download failed: ${err && err.message}`);
        }
      }
    });

    autoUpdater.on('update-downloaded', async (info) => {
      if (logger) logger.info(`[updater] downloaded: ${info && info.version}`);
      const { response } = await dialog.showMessageBox({
        type: 'info',
        buttons: ['إعادة التشغيل والتثبيت', 'لاحقاً'],
        defaultId: 0,
        cancelId: 1,
        title: 'التحديث جاهز',
        message: 'تم تنزيل التحديث.',
        detail: 'سيُعاد تشغيل التطبيق لإكمال التثبيت.',
      });
      if (response === 0) {
        // The installer's customInstall refreshes + restarts the service; main
        // re-verifies it on relaunch.
        autoUpdater.quitAndInstall(true, true);
      }
    });

    return autoUpdater;
  }

  async function check() {
    const updater = await init();
    if (!updater) return;
    try {
      await updater.checkForUpdates();
    } catch (err) {
      if (logger) logger.warn(`[updater] check skipped: ${err && err.message}`);
    }
  }

  return { check };
}
