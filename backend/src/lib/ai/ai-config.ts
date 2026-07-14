import type { AppConfig } from '../../config/app-config.js';

/**
 * Runtime AI configuration derived from the app config. AI is enabled ONLY
 * when both an OpenRouter key and a default model slug are configured; any
 * other state degrades to a safe "disabled" mode that never breaks boot.
 */
export interface AiRuntimeConfig {
  apiKey: string;
  baseUrl: string;
  modelDefault: string;
  /** Heavy-analysis slug; falls back to modelDefault when not configured. */
  modelHeavy: string;
  appUrl?: string;
  appTitle?: string;
  timeoutMs: number;
  monthlyTokenBudget?: number;
}

export type AiDisabledReason = 'NO_API_KEY' | 'NO_DEFAULT_MODEL' | 'SYSTEM_DISABLED';

export type AiRuntime =
  | { enabled: true; config: AiRuntimeConfig }
  | { enabled: false; reason: AiDisabledReason };

export function resolveAiRuntime(env: AppConfig): AiRuntime {
  if (!env.OPENROUTER_API_KEY) return { enabled: false, reason: 'NO_API_KEY' };
  if (!env.AI_MODEL_DEFAULT) return { enabled: false, reason: 'NO_DEFAULT_MODEL' };
  return {
    enabled: true,
    config: {
      apiKey: env.OPENROUTER_API_KEY,
      baseUrl: env.OPENROUTER_BASE_URL,
      modelDefault: env.AI_MODEL_DEFAULT,
      modelHeavy: env.AI_MODEL_HEAVY ?? env.AI_MODEL_DEFAULT,
      appUrl: env.AI_APP_URL,
      appTitle: env.AI_APP_TITLE,
      timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
      monthlyTokenBudget: env.AI_MONTHLY_TOKEN_BUDGET,
    },
  };
}
