/**
 * autoUpdater.cjs — application auto-update via electron-updater.
 *
 * Best-effort: if no publish feed is configured (no app-update.yml shipped), the
 * checks no-op rather than crash. The important production guarantee — that the
 * backend service survives an update and its schema is migrated — is handled
 * elsewhere: the NSIS customUnInstall PRESERVES the service registration on
 * ${isUpdated}, customInstall refreshes + restarts it, and the backend runs
 * `prisma migrate deploy` on boot (migrate-on-boot.ts). After quitAndInstall the
 * app relaunches and main re-verifies the service before loading the UI.
 */
let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch {
  autoUpdater = null;
}

const { dialog } = require('electron');

function setupAutoUpdater({ logger } = {}) {
  if (!autoUpdater) {
    if (logger) logger.warn('[updater] electron-updater not available — skipping');
    return { check: async () => {} };
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

  async function check() {
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      if (logger) logger.warn(`[updater] check skipped: ${err && err.message}`);
    }
  }

  return { check };
}

module.exports = { setupAutoUpdater };
