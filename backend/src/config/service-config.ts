/**
 * Service-mode application config builder.
 *
 * In production / Windows-Service mode the ENTIRE runtime configuration comes
 * from the wizard-provisioned, ACL-locked `service.json`, loaded + validated by
 * the shared loader (`@contractor-plus/shared/service-config`). This module maps
 * the resolved service config onto the backend {@link AppConfig}.
 *
 * Values that are NOT part of per-deployment `service.json` — token TTLs, the
 * bcrypt cost, the management API endpoint, the upload size limit — are supplied
 * here as fixed APPLICATION CONSTANTS. They do not vary per install and are not
 * secrets, so they are not "hidden defaults that mask invalid config": every
 * connection-critical value (DB, JWT secret, port, CORS origin, SPA path) comes
 * from service.json and fails loudly when missing or invalid.
 *
 * Explicitly absent here (the legacy patterns removed in Phase 1):
 *   - NO `import 'dotenv/config'` / no .env is ever read.
 *   - NO process.env routing or `setIfUnset` — service.json always wins.
 *   - NO early return when process.env.DATABASE_URL exists.
 *   - NO ProgramData fallback — a missing CONTRACTOR_PLUS_HOME fails loudly.
 */
import path from 'node:path';
import { loadServiceConfig } from '@contractor-plus/shared/service-config';
import type { AppConfig } from './app-config.js';

/**
 * Application constants that are intentionally not part of `service.json`.
 * (Identical to the previous zod defaults, so production behavior is unchanged.)
 */
const APP_CONSTANTS = {
  JWT_ACCESS_TTL: '15m',
  REFRESH_TOKEN_TTL_DAYS: 30,
  BCRYPT_ROUNDS: 12,
  MANAGEMENT_API_URL: 'https://manage.codelapps.com',
  MANAGEMENT_API_TIMEOUT_MS: 15_000,
  MAX_UPLOAD_SIZE_MB: 5,
  // AI endpoint + timeout are application constants (overridable per install
  // via the optional service.json `ai` block). Model SLUGS are deliberately
  // NOT constants — they change on openrouter.ai and come only from config.
  OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
  AI_APP_TITLE: 'Contractor Plus',
  AI_REQUEST_TIMEOUT_MS: 30_000,
} as const;

/**
 * Build the backend {@link AppConfig} from `service.json`. Throws `ConfigError`
 * (SERVICE_HOME_NOT_SET / SERVICE_CONFIG_NOT_FOUND / _INVALID_JSON /
 * _INVALID_SCHEMA) when the configuration is missing or invalid — surfaced by
 * env.ts as a clean exit(1) BEFORE Prisma or Fastify initialize.
 */
export function buildServiceModeConfig(): AppConfig {
  const cfg = loadServiceConfig();

  return {
    NODE_ENV: 'production',
    PORT: cfg.port,
    DATABASE_URL: cfg.databaseUrl,
    JWT_ACCESS_SECRET: cfg.jwtSecret,
    JWT_ACCESS_TTL: APP_CONSTANTS.JWT_ACCESS_TTL,
    REFRESH_TOKEN_TTL_DAYS: APP_CONSTANTS.REFRESH_TOKEN_TTL_DAYS,
    BCRYPT_ROUNDS: APP_CONSTANTS.BCRYPT_ROUNDS,
    CORS_ORIGIN: cfg.corsOrigin,
    MANAGEMENT_API_URL: APP_CONSTANTS.MANAGEMENT_API_URL,
    LOCAL_SERVICE_URL: `http://127.0.0.1:${cfg.port}`,
    MANAGEMENT_API_TIMEOUT_MS: APP_CONSTANTS.MANAGEMENT_API_TIMEOUT_MS,
    // Derived from the validated home; keeps uploads at <home>/data/uploads
    // without routing through process.env (matches prior production location).
    UPLOAD_ROOT: path.join(cfg.dataDir, 'uploads'),
    MAX_UPLOAD_SIZE_MB: APP_CONSTANTS.MAX_UPLOAD_SIZE_MB,
    FRONTEND_DIST: cfg.frontendDist,
    CONTRACTOR_PLUS_EXPECTED_DB: cfg.expectedDbName,
    // Optional `ai` block — absence (every existing install) means the AI
    // features are disabled; nothing about it can fail the boot.
    OPENROUTER_API_KEY: cfg.ai?.openrouterApiKey,
    OPENROUTER_BASE_URL: cfg.ai?.openrouterBaseUrl ?? APP_CONSTANTS.OPENROUTER_BASE_URL,
    AI_MODEL_DEFAULT: cfg.ai?.modelDefault,
    AI_MODEL_HEAVY: cfg.ai?.modelHeavy,
    AI_APP_URL: cfg.ai?.appUrl,
    AI_APP_TITLE: cfg.ai?.appTitle ?? APP_CONSTANTS.AI_APP_TITLE,
    AI_REQUEST_TIMEOUT_MS: cfg.ai?.requestTimeoutMs ?? APP_CONSTANTS.AI_REQUEST_TIMEOUT_MS,
    AI_MONTHLY_TOKEN_BUDGET: cfg.ai?.monthlyTokenBudget,
  };
}
