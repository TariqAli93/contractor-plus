// ============================================================
// Voice LLM configuration — isolated, env-sourced, DISABLED by default.
//
// Kept OUT of the strict typed `env`/service.json on purpose: it is optional and
// must never be required for the app to boot. Secrets (the API key) live ONLY in
// the environment — never in the database, never sent to the client, never
// logged. When disabled or unconfigured, the system runs exactly as before on
// RuleBasedNluProvider.
//
// Settings (env var → meaning):
//   VOICE_LLM_ENABLED      → voice.llm.enabled      (default false)
//   VOICE_LLM_PROVIDER     → voice.llm.provider     (anthropic | openai | groq)
//   VOICE_LLM_MODEL        → voice.llm.model
//   VOICE_LLM_BASE_URL     → voice.llm.baseUrl       (override the provider default)
//   VOICE_LLM_API_KEY      → voice.llm.apiKey        (env-only; never persisted)
//   VOICE_LLM_TIMEOUT_MS   → voice.llm.timeoutMs     (default 6000)
//   VOICE_LLM_MAX_TOKENS   → voice.llm.maxTokens     (default 700)
//   VOICE_LLM_MIN_CONFIDENCE → router escalation threshold (default 0.6)
// ============================================================

// Provider vocabulary. Adding OpenRouter / Ollama later = one entry here + one
// DEFAULT_MODELS/DEFAULT_BASE_URLS row + one Client subclass — no business logic.
export type LlmProviderName = 'anthropic' | 'openai' | 'groq';

export interface VoiceLlmConfig {
  enabled: boolean;
  provider: LlmProviderName;
  model: string;
  /** API base URL (provider default, or VOICE_LLM_BASE_URL override). */
  baseUrl: string;
  apiKey: string | null;
  timeoutMs: number;
  maxTokens: number;
  /** RuleBased confidence below this escalates the turn to the LLM. */
  minConfidence: number;
}

const DEFAULT_MODELS: Record<LlmProviderName, string> = {
  // Fast, cost-effective defaults for NLU parsing (intent + entity extraction is
  // a latency-sensitive "simple task"); overridable via VOICE_LLM_MODEL. Use the
  // clean alias, not a date-suffixed ID.
  anthropic: 'claude-haiku-4-5',
  openai: 'gpt-4o-mini',
  groq: 'llama-3.3-70b-versatile',
};

// Provider API base URLs. OpenAI-compatible providers append /chat/completions;
// Anthropic appends /messages. Any can be overridden with VOICE_LLM_BASE_URL
// (e.g. a proxy or a self-hosted OpenAI-compatible endpoint).
const DEFAULT_BASE_URLS: Record<LlmProviderName, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  groq: 'https://api.groq.com/openai/v1',
};

export function resolveBaseUrl(provider: LlmProviderName): string {
  return process.env.VOICE_LLM_BASE_URL?.trim() || DEFAULT_BASE_URLS[provider];
}

export function parseProvider(raw: string | undefined): LlmProviderName {
  const v = raw?.trim().toLowerCase();
  if (v === 'openai') return 'openai';
  if (v === 'groq') return 'groq';
  return 'anthropic';
}

// OpenAI model ids are lowercase and (currently) start with `gpt-`, `o`, or
// `chatgpt-`. Anthropic ids are case-sensitive, so those are only trimmed. These
// pure helpers back the Settings store's save-time normalization + validation
// (and the test-connection path), so a typo like "GPT-5.5" becomes "gpt-5.5"
// and a genuinely wrong name (e.g. "davinci") is rejected before it reaches the
// provider.
export function normalizeModel(provider: LlmProviderName, model: string): string {
  const trimmed = model.trim();
  // Anthropic ids are case-sensitive; OpenAI-compatible providers (OpenAI, Groq,
  // …) use lowercase ids.
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
function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function loadVoiceLlmConfig(): VoiceLlmConfig {
  const provider = parseProvider(process.env.VOICE_LLM_PROVIDER);
  return {
    enabled: bool(process.env.VOICE_LLM_ENABLED, false),
    provider,
    model: process.env.VOICE_LLM_MODEL?.trim() || DEFAULT_MODELS[provider],
    baseUrl: resolveBaseUrl(provider),
    apiKey: process.env.VOICE_LLM_API_KEY?.trim() || null,
    timeoutMs: int(process.env.VOICE_LLM_TIMEOUT_MS, 6000),
    maxTokens: int(process.env.VOICE_LLM_MAX_TOKENS, 700),
    minConfidence: num(process.env.VOICE_LLM_MIN_CONFIDENCE, 0.6),
  };
}
