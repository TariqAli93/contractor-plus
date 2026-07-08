// ============================================================
// LLM configuration — OpenRouter ONLY, env-sourced, DISABLED by default.
//
// The app depends on a single AI gateway: OpenRouter (https://openrouter.ai).
// OpenRouter exposes an OpenAI-compatible API, so one transport covers every
// underlying vendor model (the vendor prefix lives in the model id, e.g.
// "openai/gpt-4o-mini", "anthropic/claude-3.5-sonnet"). There is no provider
// selection anymore — provider is fixed.
//
// Kept OUT of the strict typed `env`/service.json on purpose: it is optional and
// must never be required for the app to boot. The secret (API key) lives ONLY in
// the environment here — never logged; the persisted key is handled (encrypted)
// by LlmSettingsStore.
//
// Env vars (new `OPENROUTER_*` primary, with legacy `AI_LLM_*` / `VOICE_LLM_*`
// honoured as a fallback so an existing dev `.env` keeps working):
//   OPENROUTER_API_KEY        → apiKey      (env-only convenience; the app
//                                            persists an encrypted key via the
//                                            settings store)
//   OPENROUTER_BASE_URL       → baseUrl     (default https://openrouter.ai/api/v1)
//   OPENROUTER_DEFAULT_MODEL  → model       (default openai/gpt-4o-mini)
//   OPENROUTER_SITE_URL       → siteUrl     (optional; sent as HTTP-Referer)
//   OPENROUTER_APP_NAME       → appName     (optional; sent as X-Title)
//   OPENROUTER_ENABLED        → enabled     (default false)
//   AI_LLM_TIMEOUT_MS         → timeoutMs   (default 15000)
//   AI_LLM_MAX_TOKENS         → maxTokens   (default 1500)
// ============================================================

// The only supported provider. Kept as a (single-member) type so every downstream
// `provider: LlmProviderName` annotation and audit column keeps compiling.
export type LlmProviderName = 'openrouter';

// How the client asks OpenRouter for structured (JSON) output. Different models
// support different modes (some only `json_schema`, some only `json_object`, some
// neither), so this is resolved per-model from the catalog's `supported_parameters`
// (see OpenRouterModelsService). `auto` = decide at call time and fall back across
// modes on an "unsupported response_format" error.
//   json_schema → response_format: { type:'json_schema', json_schema:{…} }
//   json_object → response_format: { type:'json_object' }
//   none        → no response_format; prompt-only JSON + backend Zod validation
export type StructuredOutputMode = 'auto' | 'json_schema' | 'json_object' | 'none';

export const OPENROUTER_PROVIDER: LlmProviderName = 'openrouter';
export const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
/** Safe, cheap, widely-available default (overridable via OPENROUTER_DEFAULT_MODEL). */
export const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-4o-mini';

export interface LlmConfig {
  enabled: boolean;
  provider: LlmProviderName;
  model: string;
  /** API base URL (OpenRouter default, or OPENROUTER_BASE_URL override). */
  baseUrl: string;
  apiKey: string | null;
  timeoutMs: number;
  maxTokens: number;
  /** Optional OpenRouter attribution — sent as HTTP-Referer. */
  siteUrl?: string | null;
  /** Optional OpenRouter attribution — sent as X-Title. */
  appName?: string | null;
  /** Structured-output mode for the selected model (resolved from the catalog).
   *  Omitted/`auto` → the client decides and falls back across modes on error. */
  structuredOutputMode?: StructuredOutputMode;
}

/** Read the first non-empty value across a list of env var names (in priority
 *  order), so the new `OPENROUTER_*` vars win but a legacy `AI_LLM_*` /
 *  `VOICE_LLM_*` dev `.env` keeps working unchanged. */
function env(...names: string[]): string | undefined {
  for (const name of names) {
    const v = process.env[name]?.trim();
    if (v) return v;
  }
  return undefined;
}

/** Normalize a configured base URL to exactly the API root
 *  `https://openrouter.ai/api/v1` — defensively stripping a trailing slash and
 *  any accidental endpoint suffix (`/models`, `/chat/completions`) so the final
 *  request URL is never doubled (…/v1/models/chat/completions) or malformed. */
export function normalizeBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, ''); // drop trailing slash(es)
  url = url.replace(/\/chat\/completions$/i, '').replace(/\/models$/i, '');
  return url.replace(/\/+$/, '');
}

export function resolveBaseUrl(): string {
  const raw = env('OPENROUTER_BASE_URL', 'AI_LLM_BASE_URL', 'VOICE_LLM_BASE_URL') || DEFAULT_OPENROUTER_BASE_URL;
  return normalizeBaseUrl(raw);
}

/** OpenRouter model ids are vendor-prefixed and case-sensitive (e.g.
 *  "openai/gpt-4o-mini") — only trim. Real validation is done against the live
 *  model list (see OpenRouterModelsService), not a hard-coded rule. */
export function normalizeModel(model: string): string {
  return model.trim();
}

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
}
function int(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function loadLlmConfig(): LlmConfig {
  return {
    enabled: bool(env('OPENROUTER_ENABLED', 'AI_LLM_ENABLED', 'VOICE_LLM_ENABLED'), false),
    provider: OPENROUTER_PROVIDER,
    model: env('OPENROUTER_DEFAULT_MODEL', 'AI_LLM_MODEL', 'VOICE_LLM_MODEL') || DEFAULT_OPENROUTER_MODEL,
    baseUrl: resolveBaseUrl(),
    apiKey: env('OPENROUTER_API_KEY', 'AI_LLM_API_KEY', 'VOICE_LLM_API_KEY') || null,
    timeoutMs: int(env('AI_LLM_TIMEOUT_MS', 'VOICE_LLM_TIMEOUT_MS'), 15000),
    maxTokens: int(env('AI_LLM_MAX_TOKENS', 'VOICE_LLM_MAX_TOKENS'), 1500),
    siteUrl: env('OPENROUTER_SITE_URL') || null,
    appName: env('OPENROUTER_APP_NAME') || null,
  };
}
