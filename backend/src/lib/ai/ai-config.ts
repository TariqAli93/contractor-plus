import type { AppConfig } from '../../config/app-config.js';

/**
 * AI configuration is split in two:
 *
 *  - {@link AiStaticConfig} — process-level, from env/service.json. Safe at
 *    boot, never a reason the app can't start.
 *  - {@link AiRuntimeConfig} — the changeable bits (key + models) that now live
 *    in the DB and can be edited from the control panel WITHOUT a restart.
 *
 * AI is "enabled" only when the system is on AND a key AND a default model
 * resolve; every other state degrades to a safe disabled mode.
 */
export interface AiStaticConfig {
  baseUrl: string;
  appUrl?: string;
  appTitle?: string;
  timeoutMs: number;
  monthlyTokenBudget?: number;
}

export interface AiRuntimeConfig extends AiStaticConfig {
  apiKey: string;
  modelDefault: string;
  /** Heavy-analysis slug; falls back to modelDefault when not configured. */
  modelHeavy: string;
}

/**
 * NOT_CONFIGURED — no key at all (neither DB nor the optional env fallback).
 * This is the normal first-run state and must never break boot or any screen.
 */
export type AiDisabledReason = 'NOT_CONFIGURED' | 'NO_DEFAULT_MODEL' | 'SYSTEM_DISABLED';

export type AiRuntime =
  | { enabled: true; config: AiRuntimeConfig }
  | { enabled: false; reason: AiDisabledReason };

/**
 * A provider is built against a resolver, not a frozen config: it calls
 * {@link AiRuntimeConfigResolver.resolve} on every completion so a key/model
 * change from the panel takes effect immediately, with no restart.
 */
export interface AiRuntimeConfigResolver {
  resolve(): Promise<AiRuntimeConfig>;
}

/** The static (env-derived) half of the config — always available. */
export function resolveStaticConfig(env: AppConfig): AiStaticConfig {
  return {
    baseUrl: env.OPENROUTER_BASE_URL,
    appUrl: env.AI_APP_URL,
    appTitle: env.AI_APP_TITLE,
    timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
    monthlyTokenBudget: env.AI_MONTHLY_TOKEN_BUDGET,
  };
}

/**
 * Env-only runtime resolution — used solely for the boot log line. The real
 * resolution (DB-first, env fallback) lives in AiSettingsService. Never throws;
 * a missing key is NOT_CONFIGURED, not a crash.
 */
export function resolveAiRuntime(env: AppConfig): AiRuntime {
  if (!env.OPENROUTER_API_KEY) return { enabled: false, reason: 'NOT_CONFIGURED' };
  if (!env.AI_MODEL_DEFAULT) return { enabled: false, reason: 'NO_DEFAULT_MODEL' };
  return {
    enabled: true,
    config: {
      ...resolveStaticConfig(env),
      apiKey: env.OPENROUTER_API_KEY,
      modelDefault: env.AI_MODEL_DEFAULT,
      modelHeavy: env.AI_MODEL_HEAVY ?? env.AI_MODEL_DEFAULT,
    },
  };
}
