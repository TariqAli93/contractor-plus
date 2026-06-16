import 'dotenv/config';
import { z } from 'zod';
import { loadServiceConfigIntoEnv } from './service-config.js';

// In Windows-Service mode this reconstructs DATABASE_URL/JWT/PORT/etc. from
// %ProgramData%\ContractorPlus and injects them into process.env. It is a no-op
// in dev and the Electron child path, so the schema below sees the same env.
loadServiceConfigIntoEnv();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_ACCESS_TTL: z.string().default('15m'),

  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),

  CORS_ORIGIN: z.string().default('*'),

  // Remote-access (tunnel agent). The local backend is a thin client — it
  // calls MANAGEMENT_API_URL to provision/revoke a Cloudflare tunnel and uses
  // LOCAL_SERVICE_URL as the ingress target inside the generated cloudflared
  // config. No API key, machine id, or subdomain is configured here; the
  // machine id is generated/persisted locally, the subdomain is assigned by
  // the management server.
  MANAGEMENT_API_URL: z.string().url().default('https://manage.codelapps.com'),
  LOCAL_SERVICE_URL: z.string().url().optional(),
  MANAGEMENT_API_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),

  // File uploads. UPLOAD_ROOT is resolved at boot-time; when unset, the
  // storage service falls back to <userDataDir>/uploads so dev + Electron
  // both work without configuration. MAX_UPLOAD_SIZE_MB applies to every
  // single-file upload across the system.
  UPLOAD_ROOT: z.string().optional(),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().int().positive().max(50).default(5),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;
