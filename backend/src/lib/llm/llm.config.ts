// ============================================================
// LLM configuration — isolated, env-sourced, DISABLED by default.
//
// Shared, provider-agnostic transport config for the AI Command Workflow system
// (and any future LLM consumer). Kept OUT of the strict typed `env`/service.json
// on purpose: it is optional and must never be required for the app to boot.
// Secrets (the API key) live ONLY in the environment here — never logged; the
// persisted key is handled (encrypted) by LlmSettingsStore.
//
// Env vars (new `AI_LLM_*`, with legacy `VOICE_LLM_*` honoured as a fallback so
// an existing dev `.env` keeps working):
//   AI_LLM_ENABLED    → enabled     (default false)
//   AI_LLM_PROVIDER   → provider    (anthropic | openai | groq)
//   AI_LLM_MODEL      → model
//   AI_LLM_BASE_URL   → baseUrl     (override the provider default)
//   AI_LLM_API_KEY    → apiKey      (env-only convenience; the app persists an
//                                    encrypted key via the settings store)
//   AI_LLM_TIMEOUT_MS → timeoutMs   (default 15000 — workflow planning is a
//                                    heavier task than the old NLU parse)
//   AI_LLM_MAX_TOKENS → maxTokens   (default 1500)
// ============================================================

// Provider vocabulary. Adding OpenRouter / Ollama later = one entry here + one
// DEFAULT_MODELS/DEFAULT_BASE_URLS row + one Client subclass — no business logic.
export type LlmProviderName = 'anthropic' | 'openai' | 'groq' | 'gemini' | 'openrouter';

export interface LlmConfig {
  enabled: boolean;
  provider: LlmProviderName;
  model: string;
  /** API base URL (provider default, or AI_LLM_BASE_URL override). */
  baseUrl: string;
  apiKey: string | null;
  timeoutMs: number;
  maxTokens: number;
}

const DEFAULT_MODELS: Record<LlmProviderName, string> = {
  // Capable defaults for structured workflow planning (intent + slot extraction
  // + plan construction is more demanding than a single-intent parse), each
  // overridable via AI_LLM_MODEL. Use the clean alias, not a date-suffixed ID.
  anthropic: 'claude-haiku-4-5',
  openai: 'gpt-4o-mini',
  groq: 'llama-3.3-70b-versatile',
  gemini: 'gemini-2.0-flash',
  openrouter: 'openai/gpt-4o-mini',
};

// Provider API base URLs. OpenAI-compatible providers append /chat/completions;
// Anthropic appends /messages. Any can be overridden with AI_LLM_BASE_URL
// (e.g. a proxy or a self-hosted OpenAI-compatible endpoint).
const DEFAULT_BASE_URLS: Record<LlmProviderName, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  // Gemini via its OpenAI-compatibility endpoint (Bearer key, /chat/completions).
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  openrouter: 'https://openrouter.ai/api/v1',
};

/** Read a config value from the new `AI_LLM_*` var, falling back to the legacy
 *  `VOICE_LLM_*` var so an existing dev `.env` keeps working unchanged. */
function pickEnv(suffix: string): string | undefined {
  return process.env[`AI_LLM_${suffix}`]?.trim() || process.env[`VOICE_LLM_${suffix}`]?.trim();
}

export function resolveBaseUrl(provider: LlmProviderName): string {
  return pickEnv('BASE_URL') || DEFAULT_BASE_URLS[provider];
}

export function parseProvider(raw: string | undefined): LlmProviderName {
  const v = raw?.trim().toLowerCase();
  if (v === 'openai') return 'openai';
  if (v === 'groq') return 'groq';
  if (v === 'gemini') return 'gemini';
  if (v === 'openrouter') return 'openrouter';
  return 'anthropic';
}

// OpenAI model ids are lowercase and (currently) start with `gpt-`, `o`, or
// `chatgpt-`. Anthropic ids are case-sensitive, so those are only trimmed. These
// pure helpers back the settings store's save-time normalization + validation
// (and the test-connection path), so a typo like "GPT-5.5" becomes "gpt-5.5"
// and a genuinely wrong name (e.g. "davinci") is rejected before it reaches the
// provider.
export function normalizeModel(provider: LlmProviderName, model: string): string {
  const trimmed = model.trim();
  return provider === 'anthropic' ? trimmed : trimmed.toLowerCase();
}

export function isValidModelForProvider(provider: LlmProviderName, model: string): boolean {
  if (provider !== 'openai') return true;
  return model.startsWith('gpt-') || model.startsWith('o') || model.startsWith('chatgpt-');
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
  const provider = parseProvider(pickEnv('PROVIDER'));
  return {
    enabled: bool(pickEnv('ENABLED'), false),
    provider,
    model: pickEnv('MODEL') || DEFAULT_MODELS[provider],
    baseUrl: resolveBaseUrl(provider),
    apiKey: pickEnv('API_KEY') || null,
    timeoutMs: int(pickEnv('TIMEOUT_MS'), 15000),
    maxTokens: int(pickEnv('MAX_TOKENS'), 1500),
  };
}
