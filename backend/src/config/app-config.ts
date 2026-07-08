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
export interface AppConfig {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  DATABASE_URL: string;
  JWT_ACCESS_SECRET: string;
  /** Dedicated key for at-rest secret encryption (lib/crypto). Optional; when
   *  absent the app falls back to JWT_ACCESS_SECRET and warns at startup. */
  SECRET_ENCRYPTION_KEY?: string;
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
}
