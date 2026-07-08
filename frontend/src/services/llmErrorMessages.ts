import { t } from '@/i18n';

// The SINGLE frontend source that turns a coded LLM/AI failure (the `reason` the
// AI backends return, and the `error` code the settings "test connection" flow
// returns) into a localized message via `settings.ai.testErrors.*`. Both the AI
// console store and the AI settings tab consume this, so there is exactly one map.
const CODE_TO_KEY: Record<string, string> = {
  no_api_key: 'noKey',
  invalid_api_key: 'badKey',
  insufficient_quota: 'quota',
  insufficient_credits: 'credits',
  rate_limited: 'rateLimited',
  timeout: 'timeout',
  network_error: 'network',
  server_error: 'server',
  client_unavailable: 'unavailable',
  model_not_found: 'modelNotFound',
  unsupported_response_format: 'badFormat',
  malformed_response: 'malformed',
  unknown_error: 'generic',
};

/** True when `code` is a known LLM/AI provider-failure code. */
export function isLlmErrorCode(code: string | null | undefined): boolean {
  return !!code && code in CODE_TO_KEY;
}

/**
 * Localize a coded AI failure. Known codes resolve to a `settings.ai.testErrors.*`
 * message; anything else falls back to the server-supplied message (already
 * Arabic) or the generic connection message.
 */
export function llmErrorMessage(code: string | null | undefined, fallback?: string | null): string {
  const key = code ? CODE_TO_KEY[code] : undefined;
  if (key) return t(`settings.ai.testErrors.${key}`);
  return fallback || t('settings.ai.testErrors.generic');
}
