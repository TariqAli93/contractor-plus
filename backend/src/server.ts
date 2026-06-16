import { buildApp } from './app.js';
import { env } from './config/env.js';
import { runMigrationsIfService } from './setup/migrate-on-boot.js';

async function start() {
  // Service mode only: apply pending migrations before anything touches the DB
  // (no-op in dev / Electron child — see migrate-on-boot.ts).
  runMigrationsIfService();

  const app = await buildApp();

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // Re-spawn cloudflared if the user had remote access enabled before the
  // previous shutdown. Best-effort — failures are logged but don't block boot.
  if (app.tunnelService) {
    try {
      const result = await app.tunnelService.resumeIfPreviouslyEnabled();
      if (!result.resumed && result.reason && result.reason !== 'not_enabled') {
        app.log.warn({ reason: result.reason }, '[tunnel] auto-resume skipped');
      }
    } catch (err) {
      app.log.error({ err }, '[tunnel] auto-resume threw');
    }
  } else {
    app.log.warn('[tunnel] service unavailable — skipping auto-resume');
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down...');
    if (app.tunnelService) {
      try {
        await app.tunnelService.shutdown();
      } catch (err) {
        app.log.error({ err }, '[tunnel] shutdown error');
      }
    }
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void start();
