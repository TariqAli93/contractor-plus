import { PrismaClient } from '@prisma/client';
import { assertDatabaseName, ConfigError, formatConfigError } from '@contractor-plus/shared/service-config';
import { env } from '../config/env.js';

// Single-source-of-truth guard, BEFORE the PrismaClient connects. DATABASE_URL
// and the expected database name both derive from the validated config
// (service.json in service mode; the launcher-injected values in dev). If they
// disagree a stale value leaked in — hard-stop (DATABASE_NAME_MISMATCH) instead
// of silently connecting to the wrong database.
if (env.CONTRACTOR_PLUS_EXPECTED_DB) {
  try {
    assertDatabaseName(env.DATABASE_URL, env.CONTRACTOR_PLUS_EXPECTED_DB);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`[config] ${formatConfigError(err)}`);
      process.exit(1);
    }
    throw err;
  }
}

// The connection URL comes from the validated typed config — NOT process.env.
// In service mode service.json is the only source and DATABASE_URL is never put
// on process.env, so the schema's `env("DATABASE_URL")` would otherwise be unset.
// Passing datasourceUrl makes the typed config authoritative for Prisma too.
export const prisma = new PrismaClient({
  datasourceUrl: env.DATABASE_URL,
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});
