/**
 * Foundation configuration — the small, typed surface the composition root needs
 * to wire the foundational adapters.
 *
 * It reads `process.env` directly with safe defaults rather than importing the
 * zod-validated `config/env.ts`, so the composition root and its tests carry no
 * environment-validation side effect at import time. The full env schema still
 * governs the running service; this is the subset the container assembles from.
 */
export type NodeEnv = 'development' | 'production' | 'test';

export interface FoundationConfig {
  readonly nodeEnv: NodeEnv;
  readonly isDevelopment: boolean;
  readonly isProduction: boolean;
  /**
   * IANA timezone for deriving the business day (DATABASE.md §9.3,
   * AUTOMATION.md §16.4). Defaults to the deployment's locale, `Asia/Baghdad`;
   * "3am" means the contractor's 3am, never UTC.
   */
  readonly timezone: string;
}

export function loadFoundationConfig(
  env: Record<string, string | undefined> = process.env,
): FoundationConfig {
  const raw = env.NODE_ENV;
  const nodeEnv: NodeEnv = raw === 'production' || raw === 'test' ? raw : 'development';
  const timezone = env.APP_TIMEZONE?.trim() || 'Asia/Baghdad';
  return {
    nodeEnv,
    isDevelopment: nodeEnv === 'development',
    isProduction: nodeEnv === 'production',
    timezone,
  };
}
