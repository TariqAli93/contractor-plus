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
//   VOICE_LLM_PROVIDER     → voice.llm.provider     (anthropic | openai)
//   VOICE_LLM_MODEL        → voice.llm.model
//   VOICE_LLM_API_KEY      → voice.llm.apiKey        (env-only; never persisted)
//   VOICE_LLM_TIMEOUT_MS   → voice.llm.timeoutMs     (default 6000)
//   VOICE_LLM_MAX_TOKENS   → voice.llm.maxTokens     (default 700)
//   VOICE_LLM_MIN_CONFIDENCE → router escalation threshold (default 0.6)
// ============================================================

export type LlmProviderName = 'anthropic' | 'openai';

export interface VoiceLlmConfig {
  enabled: boolean;
  provider: LlmProviderName;
  model: string;
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
};

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
  const provider: LlmProviderName =
    process.env.VOICE_LLM_PROVIDER?.trim().toLowerCase() === 'openai' ? 'openai' : 'anthropic';
  return {
    enabled: bool(process.env.VOICE_LLM_ENABLED, false),
    provider,
    model: process.env.VOICE_LLM_MODEL?.trim() || DEFAULT_MODELS[provider],
    apiKey: process.env.VOICE_LLM_API_KEY?.trim() || null,
    timeoutMs: int(process.env.VOICE_LLM_TIMEOUT_MS, 6000),
    maxTokens: int(process.env.VOICE_LLM_MAX_TOKENS, 700),
    minConfidence: num(process.env.VOICE_LLM_MIN_CONFIDENCE, 0.6),
  };
}
