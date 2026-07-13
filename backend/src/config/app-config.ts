/**
 * The typed backend application configuration.
 *
 * Built by `config/env.ts` from exactly one source per mode:
 *   - service/production mode → the shared service.json loader (sole source)
 *   - dev/test mode           → the legacy dotenv + process.env schema
 *
 * Field names are identical across both modes so no consumer module changes.
 * This type lives in its own file to keep `env.ts` and `service-config.ts` free
 * of an import cycle.
 */
/** One external material-price source (Phase 5) — see ai-material-prices. */
export interface MaterialPriceSource {
  name: string;
  url: string;
  region?: string;
}

export interface AppConfig {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  DATABASE_URL: string;
  JWT_ACCESS_SECRET: string;
  JWT_ACCESS_TTL: string;
  REFRESH_TOKEN_TTL_DAYS: number;
  BCRYPT_ROUNDS: number;
  CORS_ORIGIN: string;
  MANAGEMENT_API_URL: string;
  LOCAL_SERVICE_URL?: string;
  MANAGEMENT_API_TIMEOUT_MS: number;
  UPLOAD_ROOT?: string;
  MAX_UPLOAD_SIZE_MB: number;
  /** Absolute path to the built SPA the service serves (single origin). */
  FRONTEND_DIST?: string;
  /** Database name the runtime expects — arms the prisma single-source guard. */
  CONTRACTOR_PLUS_EXPECTED_DB?: string;

  // ---- AI (OpenRouter — the ONLY provider) ----
  // Absence of the key (or of a default model slug) disables AI features
  // safely at boot; nothing here is ever required for the app to start.
  /** OpenRouter secret key. Absent → AI features disabled. */
  OPENROUTER_API_KEY?: string;
  OPENROUTER_BASE_URL: string;
  /** OpenRouter model slug for everyday operations — env-supplied, never hardcoded. */
  AI_MODEL_DEFAULT?: string;
  /** OpenRouter model slug for heavy analyses; falls back to AI_MODEL_DEFAULT. */
  AI_MODEL_HEAVY?: string;
  /** Sent as HTTP-Referer to OpenRouter (optional, app-ranking attribution). */
  AI_APP_URL?: string;
  /** Sent as X-Title to OpenRouter (optional). */
  AI_APP_TITLE?: string;
  AI_REQUEST_TIMEOUT_MS: number;
  /** Monthly token ceiling for governance; unlimited when unset. */
  AI_MONTHLY_TOKEN_BUDGET?: number;
  /** Phase 5 — external material-price sources; empty → sync is a no-op. */
  AI_MATERIAL_PRICE_SOURCES: MaterialPriceSource[];
  /** Phase 5 — scheduled sync cadence (hours); unset → manual sync only. */
  AI_MATERIAL_PRICE_SYNC_INTERVAL_HOURS?: number;
}
