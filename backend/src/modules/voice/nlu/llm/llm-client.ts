// ============================================================
// LLM client — the provider-agnostic transport (Anthropic / OpenAI / Groq).
//
// A thin HTTP boundary: given a system + user prompt, return the model's TEXT.
// No domain knowledge, no DB, no Services. Adding a provider = one more adapter
// implementing LlmClient — or, for an OpenAI-compatible API (Groq, OpenRouter,
// Ollama, …), one more subclass of BaseOpenAiCompatibleClient that only sets its
// `name`. Nothing else in the engine changes.
//
// Failures are unified into LLMError (provider + status + code + retryable), so
// downstream code never sees provider-specific status strings. Rate limits (429)
// and transient 503s are retried with exponential backoff; everything else fails
// fast. On any failure the interpreter degrades to RuleBased — the assistant is
// never disabled.
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

// ---------------------------------------------------------------------------
// Unified error model
// ---------------------------------------------------------------------------

export type LlmErrorCode =
  | 'invalid_api_key'
  | 'insufficient_quota'
  | 'rate_limited'
  | 'model_not_found'
  | 'timeout'
  | 'network_error'
  | 'server_error'
  | 'unknown_error';

export class LLMError extends Error {
  constructor(
    readonly provider: LlmProviderName,
    readonly status: number | null,
    readonly code: LlmErrorCode,
    readonly retryable: boolean,
    readonly retryAfterMs: number | null = null,
  ) {
    super(code);
    this.name = 'LLMError';
  }
}

/** Pull an error code/type from a provider's JSON error body (OpenAI-style
 *  `{"error":{"code","type"}}` / Anthropic `{"error":{"type"}}`). Used ONLY to
 *  refine classification (e.g. quota vs rate-limit); the body is never logged. */
function extractErrorCode(bodyText: string | undefined): string | null {
  if (!bodyText) return null;
  try {
    const j = JSON.parse(bodyText) as { error?: { code?: string; type?: string } };
    return j.error?.code ?? j.error?.type ?? null;
  } catch {
    return null;
  }
}

/** Map an HTTP failure (any provider) to a stable, key-safe LLMError. */
export function classifyHttpError(
  provider: LlmProviderName,
  status: number,
  bodyText: string | undefined,
  retryAfter: string | null,
): LLMError {
  const bodyCode = extractErrorCode(bodyText);
  let code: LlmErrorCode = 'unknown_error';
  let retryable = false;

  if (status === 401 || status === 403) code = 'invalid_api_key';
  else if (status === 404) code = 'model_not_found';
  else if (status === 408) code = 'timeout';
  else if (status === 429) {
    if (bodyCode === 'insufficient_quota' || bodyCode === 'billing_hard_limit_reached') {
      code = 'insufficient_quota'; // a quota wall won't clear by retrying
    } else {
      code = 'rate_limited';
      retryable = true;
    }
  } else if (status === 503) {
    code = 'server_error';
    retryable = true;
  } else if (status >= 500) {
    code = 'server_error';
  } else if (status === 400) {
    code = bodyCode === 'model_not_found' ? 'model_not_found' : 'unknown_error';
  }

  const retryAfterMs = status === 429 || status === 503 ? parseRetryAfter(retryAfter) : null;
  return new LLMError(provider, status, code, retryable, retryAfterMs);
}

/** Wrap a non-HTTP failure (abort/timeout or a network error) as an LLMError. */
function toTransportError(provider: LlmProviderName, err: unknown): LLMError {
  if (err instanceof LLMError) return err;
  const name = err instanceof Error ? err.name : '';
  if (name === 'AbortError' || name === 'TimeoutError') {
    return new LLMError(provider, null, 'timeout', false);
  }
  return new LLMError(provider, null, 'network_error', false);
}

// ---------------------------------------------------------------------------
// Retry policy — 429 + 503 only, exponential backoff (+ jitter / Retry-After)
// ---------------------------------------------------------------------------

const BACKOFF_MS: readonly number[] = [500, 1000, 2000];
const MAX_RETRIES = BACKOFF_MS.length;

function jitter(): number {
  return Math.floor(Math.random() * 251); // 0–250ms
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
/** Retry-After (delta-seconds) → ms, capped so a rogue value can't stall a turn.
 *  The HTTP-date form is ignored (backoff is used instead). */
export function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const secs = Number(header.trim());
  if (Number.isFinite(secs) && secs >= 0) return Math.min(Math.round(secs * 1000), 20000);
  return null;
}

/** Run an attempt; retry ONLY retryable LLMErrors (429 rate-limit, 503) up to 3
 *  times with 500/1000/2000ms backoff (+jitter), honoring Retry-After. Every
 *  other error — and the exhausted rate-limit — is thrown for the caller to
 *  degrade to RuleBased. */
async function retrying(run: () => Promise<string>): Promise<string> {
  let lastErr: LLMError | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const ra = lastErr?.retryAfterMs ?? null;
      const base = ra ?? BACKOFF_MS[attempt - 1] ?? 2000;
      await sleep(ra != null ? base : base + jitter());
    }
    try {
      return await run();
    } catch (err) {
      if (!(err instanceof LLMError)) throw err; // request() only ever throws LLMError
      if (!err.retryable) throw err;
      lastErr = err;
      logger.warn(
        { provider: err.provider, status: err.status, code: err.code, attempt },
        '[voice-llm] retryable error — backing off',
      );
    }
  }
  logger.warn(
    { provider: lastErr?.provider, status: lastErr?.status, code: lastErr?.code },
    '[voice-llm] retries exhausted',
  );
  throw lastErr!;
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

// ---------------------------------------------------------------------------
// OpenAI-compatible base (OpenAI, Groq, and future OpenRouter / Ollama)
// ---------------------------------------------------------------------------

abstract class BaseOpenAiCompatibleClient implements LlmClient {
  abstract readonly name: LlmProviderName;

  constructor(
    protected readonly apiKey: string,
    readonly model: string,
    protected readonly baseUrl: string,
    protected readonly timeoutMs: number,
    protected readonly maxTokens: number,
  ) {}

  complete(req: LlmCompletionRequest): Promise<string> {
    return retrying(() => this.request(req));
  }

  /** Per-provider auth. OpenAI + Groq both use a Bearer token; a future provider
   *  with different auth overrides just this. */
  protected authHeaders(): Record<string, string> {
    return { authorization: `Bearer ${this.apiKey}` };
  }

  private async request(req: LlmCompletionRequest): Promise<string> {
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

    let res: Response;
    try {
      res = await withTimeout(this.timeoutMs, (signal) =>
        fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          signal,
          headers: { 'content-type': 'application/json', ...this.authHeaders() },
          body,
        }),
      );
    } catch (err) {
      throw toTransportError(this.name, err);
    }

    if (!res.ok) {
      // Drain the error body — used only to refine the code, never logged; it may
      // carry the provider's reason but never the API key (that's in the request).
      const bodyText = await res.text().catch(() => undefined);
      throw classifyHttpError(this.name, res.status, bodyText, res.headers.get('retry-after'));
    }

    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new LLMError(this.name, res.status, 'unknown_error', false);
    return text;
  }
}

class OpenAiLlmClient extends BaseOpenAiCompatibleClient {
  readonly name = 'openai' as const;
}

class GroqLlmClient extends BaseOpenAiCompatibleClient {
  readonly name = 'groq' as const;
}

// ---------------------------------------------------------------------------
// Anthropic (Messages API — not OpenAI-compatible, so its own adapter)
// ---------------------------------------------------------------------------

class AnthropicLlmClient implements LlmClient {
  readonly name = 'anthropic' as const;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly maxTokens: number,
  ) {}

  complete(req: LlmCompletionRequest): Promise<string> {
    return retrying(() => this.request(req));
  }

  private async request(req: LlmCompletionRequest): Promise<string> {
    let res: Response;
    try {
      res = await withTimeout(this.timeoutMs, (signal) =>
        fetch(`${this.baseUrl}/messages`, {
          method: 'POST',
          signal,
          headers: {
            'content-type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
          },
          // temperature intentionally omitted — removed on the newest Claude models.
          body: JSON.stringify({
            model: this.model,
            max_tokens: this.maxTokens,
            system: req.system,
            messages: [{ role: 'user', content: req.user }],
          }),
        }),
      );
    } catch (err) {
      throw toTransportError(this.name, err);
    }

    if (!res.ok) {
      const bodyText = await res.text().catch(() => undefined);
      throw classifyHttpError(this.name, res.status, bodyText, res.headers.get('retry-after'));
    }

    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = data.content?.find((c) => c.type === 'text')?.text;
    if (!text) throw new LLMError(this.name, res.status, 'unknown_error', false);
    return text;
  }
}

/** Build a client from config, or null when the LLM is disabled/unconfigured. */
export function createLlmClient(config: VoiceLlmConfig): LlmClient | null {
  if (!config.enabled || !config.apiKey) return null;
  const { apiKey, model, baseUrl, timeoutMs, maxTokens } = config;
  switch (config.provider) {
    case 'openai':
      return new OpenAiLlmClient(apiKey, model, baseUrl, timeoutMs, maxTokens);
    case 'groq':
      return new GroqLlmClient(apiKey, model, baseUrl, timeoutMs, maxTokens);
    case 'anthropic':
      return new AnthropicLlmClient(apiKey, model, baseUrl, timeoutMs, maxTokens);
  }
}
