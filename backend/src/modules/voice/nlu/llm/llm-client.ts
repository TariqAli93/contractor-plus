// ============================================================
// LLM client — the provider-agnostic transport (Anthropic / OpenAI).
//
// A thin HTTP boundary: given a system + user prompt, return the model's TEXT.
// No domain knowledge, no DB, no Services. Adding a provider = one more adapter
// implementing LlmClient; nothing else changes. Every call is hard-bounded by a
// timeout so a slow/down provider degrades to RuleBased instead of hanging.
// ============================================================

import type { LlmProviderName, VoiceLlmConfig } from './voice-llm.config.js';
import { logger } from '../../../../lib/logger.js';

export interface LlmCompletionRequest {
  system: string;
  user: string;
}

export interface LlmClient {
  readonly name: LlmProviderName;
  readonly model: string;
  complete(req: LlmCompletionRequest): Promise<string>;
}

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

class AnthropicLlmClient implements LlmClient {
  readonly name = 'anthropic' as const;
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly timeoutMs: number,
    private readonly maxTokens: number,
  ) {}

  async complete(req: LlmCompletionRequest): Promise<string> {
    return withTimeout(this.timeoutMs, async (signal) => {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        // NOTE: `temperature` is intentionally omitted — it is removed on the
        // newest Claude models (Opus 4.8/4.7, Sonnet 5, Fable 5) and returns a
        // 400 there. Omitting it is accepted on every current model, keeping the
        // user-configurable VOICE_LLM_MODEL forward-compatible.
        body: JSON.stringify({
          model: this.model,
          max_tokens: this.maxTokens,
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
        }),
      });
      if (!res.ok) throw new Error(`anthropic_http_${res.status}`);
      const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      const text = data.content?.find((c) => c.type === 'text')?.text;
      if (!text) throw new Error('anthropic_empty_response');
      return text;
    });
  }
}

// OpenAI 429 retry policy: up to 3 retries with 500/1000/2000ms backoff
// (+ 0–250ms jitter). A Retry-After header, when present, overrides the delay.
// After the retries are exhausted the client throws `openai_rate_limited`, which
// the interpreter catches and degrades to RuleBased (never disables the voice).
const OPENAI_BACKOFF_MS: readonly number[] = [500, 1000, 2000];
const OPENAI_MAX_RETRIES = OPENAI_BACKOFF_MS.length;

function jitter(): number {
  return Math.floor(Math.random() * 251); // 0–250ms
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
/** Parse a Retry-After header (delta-seconds) to ms, capped so a rogue value
 *  can't stall a voice turn. The HTTP-date form is ignored (backoff is used). */
export function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const secs = Number(header.trim());
  if (Number.isFinite(secs) && secs >= 0) return Math.min(Math.round(secs * 1000), 20000);
  return null;
}

/** Map an OpenAI HTTP failure to a stable, key-safe error code. The response
 *  body is drained by the caller (it may carry OpenAI's reason but NEVER the API
 *  key — that only ever travels in the request) and is never logged. */
export function mapOpenAiStatus(status: number): string {
  if (status === 401) return 'openai_invalid_api_key';
  if (status === 404) return 'openai_model_not_found_or_not_available';
  if (status === 429) return 'openai_rate_limited';
  return `openai_http_${status}`;
}

class OpenAiLlmClient implements LlmClient {
  readonly name = 'openai' as const;
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly timeoutMs: number,
    private readonly maxTokens: number,
  ) {}

  async complete(req: LlmCompletionRequest): Promise<string> {
    const body = JSON.stringify({
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
    });

    let retryAfterMs: number | null = null;
    // attempt 0 = initial call; 1..MAX = retries. ONLY a 429 is retried — every
    // other failure (400/401/403/404, …) is terminal and thrown at once. Each
    // request is independently timeout-bounded; the backoff sleeps sit between.
    for (let attempt = 0; attempt <= OPENAI_MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const base = retryAfterMs ?? OPENAI_BACKOFF_MS[attempt - 1] ?? 2000;
        // Retry-After is honored verbatim; the default backoff gets 0–250ms jitter.
        await sleep(retryAfterMs != null ? base : base + jitter());
      }

      const res = await withTimeout(this.timeoutMs, (signal) =>
        fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          signal,
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.apiKey}`,
          },
          body,
        }),
      );

      if (res.ok) {
        const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const text = data.choices?.[0]?.message?.content;
        if (!text) throw new Error('openai_empty_response');
        return text;
      }

      // Drain the error body — it may carry OpenAI's reason but never the API
      // key (that only travels in the request), and we never log it.
      await res.text().catch(() => undefined);

      if (res.status !== 429) {
        logger.warn({ provider: 'openai', status: res.status }, '[voice-llm] request failed');
        throw new Error(mapOpenAiStatus(res.status));
      }

      // Rate-limited: note any Retry-After hint and back off (unless exhausted).
      retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
      logger.warn(
        { provider: 'openai', status: 429, attempt },
        '[voice-llm] rate-limited — backing off',
      );
    }

    logger.warn({ provider: 'openai', status: 429 }, '[voice-llm] rate-limited — giving up');
    throw new Error('openai_rate_limited');
  }
}

/** Build a client from config, or null when the LLM is disabled/unconfigured. */
export function createLlmClient(config: VoiceLlmConfig): LlmClient | null {
  if (!config.enabled || !config.apiKey) return null;
  if (config.provider === 'openai') {
    return new OpenAiLlmClient(config.apiKey, config.model, config.timeoutMs, config.maxTokens);
  }
  return new AnthropicLlmClient(config.apiKey, config.model, config.timeoutMs, config.maxTokens);
}
