/**
 * Backend application configuration — the typed object every module imports as
 * `env`.
 *
 * Two strictly separated sources, chosen once by runtime mode:
 *
 *   • Service / production mode (NODE_ENV=production OR CONTRACTOR_PLUS_HOME set):
 *     configuration comes EXCLUSIVELY from the wizard-provisioned, ACL-locked
 *     `service.json` via the shared loader. No dotenv, no process.env overrides,
 *     no hidden defaults, no `setIfUnset`, no DATABASE_URL precedence. service.json
 *     ALWAYS wins, and startup fails immediately (exit 1) if it is missing or
 *     invalid — before Prisma or Fastify initialize.
 *
 *   • Dev / test mode: the legacy `.env` (dotenv) + process.env path, preserved
 *     unchanged so `pnpm dev` and the Electron dev child keep working. dotenv is
 *     invoked ONLY here — it is never loaded in the production runtime path.
 *
 * The exported `env` object has identical field names in both modes, so no
 * downstream module needs to change.
 */
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { ConfigError, formatConfigError } from '@contractor-plus/shared/service-config';
import type { AppConfig } from './app-config.js';
import { buildServiceModeConfig } from './service-config.js';

export type { AppConfig } from './app-config.js';

/**
 * Service mode = the production Windows Service. Detection is driven by the
 * per-machine HOME the WinSW descriptor injects, NOT by NODE_ENV alone — so the
 * backend still selects service config even if a descriptor omits NODE_ENV, and
 * a standalone/manual run can opt in explicitly. Resolution order:
 *
 *   1. An EXPLICIT development/test NODE_ENV is NEVER service mode. This keeps
 *      the Electron dev child and `pnpm dev` on the legacy dotenv path even on a
 *      machine that also has the packaged service (and thus CONTRACTOR_PLUS_HOME)
 *      installed.
 *   2. CONTRACTOR_PLUS_SERVICE=1 forces service mode (explicit opt-in for
 *      standalone / diagnostic runs of dist/server.js outside WinSW).
 *   3. CONTRACTOR_PLUS_HOME present → service mode (the descriptor always sets
 *      it; verified at build time by afterPack).
 *   4. NODE_ENV=production → service mode (the descriptor also sets it; kept so a
 *      production boot without HOME still fails loudly via SERVICE_HOME_NOT_SET
 *      rather than silently falling back to dev validation).
 *
 * In this mode the shared `service.json` loader is the ONLY configuration source.
 */
export const IS_SERVICE_MODE: boolean = (() => {
  const nodeEnv = process.env.NODE_ENV?.trim();
  if (nodeEnv === 'development' || nodeEnv === 'test') return false;
  if (process.env.CONTRACTOR_PLUS_SERVICE?.trim() === '1') return true;
  if (process.env.CONTRACTOR_PLUS_HOME?.trim()) return true;
  return nodeEnv === 'production';
})();

// ── dev / test only: legacy dotenv + process.env schema (unchanged behavior) ──
const DevEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  CORS_ORIGIN: z.string().default('*'),
  MANAGEMENT_API_URL: z.string().url().default('https://manage.codelapps.com'),
  LOCAL_SERVICE_URL: z.string().url().optional(),
  MANAGEMENT_API_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  UPLOAD_ROOT: z.string().optional(),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().int().positive().max(50).default(5),
});

function buildDevConfig(): AppConfig {
  // dotenv is invoked ONLY in dev/test — never in the production runtime path.
  loadDotenv();
  const parsed = DevEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('[config] invalid dev environment variables:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  const e = parsed.data;
  return {
    NODE_ENV: e.NODE_ENV,
    PORT: e.PORT,
    DATABASE_URL: e.DATABASE_URL,
    JWT_ACCESS_SECRET: e.JWT_ACCESS_SECRET,
    JWT_ACCESS_TTL: e.JWT_ACCESS_TTL,
    REFRESH_TOKEN_TTL_DAYS: e.REFRESH_TOKEN_TTL_DAYS,
    BCRYPT_ROUNDS: e.BCRYPT_ROUNDS,
    CORS_ORIGIN: e.CORS_ORIGIN,
    MANAGEMENT_API_URL: e.MANAGEMENT_API_URL,
    LOCAL_SERVICE_URL: e.LOCAL_SERVICE_URL,
    MANAGEMENT_API_TIMEOUT_MS: e.MANAGEMENT_API_TIMEOUT_MS,
    UPLOAD_ROOT: e.UPLOAD_ROOT,
    MAX_UPLOAD_SIZE_MB: e.MAX_UPLOAD_SIZE_MB,
    // In dev these are injected by the Electron launcher (process.env), not .env.
    FRONTEND_DIST: process.env.FRONTEND_DIST?.trim() || undefined,
    CONTRACTOR_PLUS_EXPECTED_DB: process.env.CONTRACTOR_PLUS_EXPECTED_DB?.trim() || undefined,
  };
}

function loadConfig(): AppConfig {
  try {
    return IS_SERVICE_MODE ? buildServiceModeConfig() : buildDevConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`[config] ${formatConfigError(err)}`);
    } else {
      console.error('[config] failed to load configuration:', err instanceof Error ? err.message : err);
    }
    process.exit(1);
  }
}

/**
 * Validated, typed application configuration. In service/production mode this is
 * sourced exclusively from `service.json`; in dev/test from `.env` + process.env.
 */
export const env: AppConfig = loadConfig();
