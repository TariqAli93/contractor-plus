import type { PrismaClient } from '@prisma/client';
import type { AuditActor } from '../audit/audit.service.js';
import { AiAssistantService } from './ai-assistant.service.js';

// Phase 5 — the scheduled material-price sync. This runs inside the BACKEND
// process (dev `tsx`, or the ContractorPlusBackend Windows Service in prod),
// which is exactly what the spec requires ("within the service, not
// Electron"): the Electron shell only ever spawns the backend as a child, so
// this code never executes in the desktop process.
//
// Started from server.ts (NOT app.ts), so it never runs in the test process
// that boots the app via buildApp(). Manual sync (POST /ai/materials/
// sync-prices) is always available regardless of this scheduler.

/** A system actor — the sync is attributed with a null user in the audit log. */
const SYSTEM_ACTOR: AuditActor = { userId: null };

/** Delay before the first catch-up run, so boot isn't blocked by a fetch. */
const INITIAL_DELAY_MS = 10_000;

/** Minimal logger surface (satisfied structurally by the Fastify logger). */
interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface MaterialPriceScheduler {
  stop(): void;
}

export interface StartMaterialPriceSchedulerOptions {
  prisma: PrismaClient;
  log: Logger;
  /** Cadence in hours; absent/0 → not scheduled (manual sync only). */
  intervalHours?: number;
}

/**
 * Start the recurring sync. Returns `null` (nothing to stop) when no cadence
 * is configured or no sources exist — in that case the feature is manual-only.
 * Timers are unref'd so they never keep the process alive on their own; the
 * HTTP server owns the lifetime, and `stop()` clears them on shutdown.
 */
export function startMaterialPriceScheduler(
  opts: StartMaterialPriceSchedulerOptions,
): MaterialPriceScheduler | null {
  const { prisma, log, intervalHours } = opts;
  if (!intervalHours || intervalHours <= 0) return null;

  const service = new AiAssistantService(prisma).materialPrices;
  if (!service.enabled) {
    log.info('[material-prices] sync interval set but no sources configured — not scheduling');
    return null;
  }

  const run = async (): Promise<void> => {
    try {
      const result = await service.syncPrices(SYSTEM_ACTOR);
      log.info(
        {
          sources: result.sources,
          inserted: result.inserted,
          skippedUnmatched: result.skippedUnmatched,
          errorCount: result.errors.length,
        },
        '[material-prices] scheduled sync complete',
      );
    } catch (err) {
      // Belt-and-suspenders: syncPrices already swallows per-source failures,
      // so reaching here is unexpected — log and keep the schedule alive.
      log.error({ err }, '[material-prices] scheduled sync threw unexpectedly');
    }
  };

  const intervalMs = intervalHours * 60 * 60 * 1000;
  const initial = setTimeout(() => void run(), INITIAL_DELAY_MS);
  const timer = setInterval(() => void run(), intervalMs);
  initial.unref?.();
  timer.unref?.();

  log.info({ intervalHours }, '[material-prices] scheduled sync enabled');
  return {
    stop() {
      clearTimeout(initial);
      clearInterval(timer);
    },
  };
}
