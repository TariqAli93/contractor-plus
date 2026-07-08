// ============================================================
// LLM client — the OpenRouter transport (the app's single AI gateway).
//
// A thin HTTP boundary: given a system + user prompt, return the model's TEXT.
// No domain knowledge, no DB, no Services. OpenRouter speaks the OpenAI-compatible
// API (POST /chat/completions), so a single adapter covers every underlying vendor
// model — the vendor prefix lives in the model id ("openai/gpt-4o-mini", …).
//
// Failures are unified into LLMError (status + code + retryable), so downstream
// code never sees raw HTTP status strings. Rate limits (429) and transient 503s
// are retried with exponential backoff; everything else fails fast.
// ============================================================

import type { LlmProviderName, LlmConfig, StructuredOutputMode } from './llm.config.js';
import { OPENROUTER_PROVIDER, normalizeBaseUrl } from './llm.config.js';
import { logger } from '../logger.js';

/** A JSON Schema the model must produce output for (OpenRouter `json_schema` mode).
 *  The backend still validates the parsed result with Zod — this only guides the
 *  model, it is NEVER trusted as validation. */
export interface JsonSchemaSpec {
  /** Sent as `json_schema.name` (a stable identifier for the shape). */
  name: string;
  /** A valid JSON Schema object describing the expected output. */
  schema: Record<string, unknown>;
  /** OpenAI/OpenRouter strict structured-output mode. Defaults to `true`; set
   *  `false` for outputs with dynamic/open-ended objects (which strict mode
   *  forbids) — the fallback chain + Zod still guarantee correctness. */
  strict?: boolean;
}

export interface LlmCompletionRequest {
  system: string;
  user: string;
  /** When present, structured JSON output is REQUIRED: the client prefers
   *  `json_schema`, falling back to `json_object` then prompt-only per the model's
   *  support (see StructuredOutputMode). */
  schema?: JsonSchemaSpec;
}

export interface LlmClient {
  readonly name: LlmProviderName;
  readonly model: string;
  complete(req: LlmCompletionRequest): Promise<string>;
}

/** A concrete structured-output decision the client actually sends on one attempt
 *  (`auto` is resolved to one of these before the request is built). */
type ConcreteMode = 'json_schema' | 'json_object' | 'none';

/** Appended to the system prompt whenever NO response_format is sent (mode `none`
 *  or the final fallback), so a model without structured-output support still
 *  returns machine-parseable JSON. Backend Zod validation runs regardless. */
const JSON_ONLY_SUFFIX =
  '\n\nIMPORTANT: Respond with a SINGLE valid JSON object ONLY. No markdown, no code' +
  ' fences, no prose before or after. The entire reply must be parseable by JSON.parse.';

// ---------------------------------------------------------------------------
// Unified error model
// ---------------------------------------------------------------------------

export type LlmErrorCode =
  | 'invalid_api_key'
  | 'insufficient_quota'
  | 'insufficient_credits'
  | 'rate_limited'
  | 'model_not_found'
  | 'unsupported_response_format'
  | 'malformed_response'
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

// ---------------------------------------------------------------------------
// Circuit breaker — fail fast when OpenRouter is repeatedly failing, so a burst
// of turns doesn't pile paid calls onto a gateway that's clearly down. Trips
// after N consecutive INFRASTRUCTURE failures; after a cooldown it allows one
// trial (half-open), closing on success or re-opening on failure. This is a
// single-gateway health guard, NOT multi-provider failover.
//
// State is module-level on purpose: a fresh client is built per request (the
// settings store resolves config each turn), so the breaker must live above the
// client to persist across those instances.
// ---------------------------------------------------------------------------

/** Failure codes that mean the GATEWAY itself is unhealthy (vs. a config error
 *  like a bad key/credits, which a cooldown can't fix) — only these trip it. */
const INFRA_FAILURE_CODES: ReadonlySet<LlmErrorCode> = new Set<LlmErrorCode>([
  'rate_limited',
  'server_error',
  'timeout',
  'network_error',
]);

type BreakerState = 'closed' | 'open' | 'half_open';

export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private halfOpen = false;

  constructor(
    private readonly threshold = 5,
    private readonly cooldownMs = 30_000,
  ) {}

  /** Throw fast (no network) while OPEN and still cooling down; once the cooldown
   *  elapses, transition to HALF-OPEN and allow a single trial call through. */
  assertClosed(provider: LlmProviderName): void {
    if (this.openedAt === null || this.halfOpen) return;
    if (Date.now() - this.openedAt < this.cooldownMs) {
      throw new LLMError(provider, null, 'server_error', false);
    }
    this.halfOpen = true; // cooldown elapsed → allow one trial
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
    this.halfOpen = false;
  }

  /** An infrastructure failure: trips OPEN at the threshold; a failed half-open
   *  trial immediately re-opens with a fresh cooldown. */
  recordFailure(): void {
    if (this.halfOpen) {
      this.halfOpen = false;
      this.openedAt = Date.now();
      return;
    }
    this.failures += 1;
    if (this.failures >= this.threshold) this.openedAt = Date.now();
  }

  state(): BreakerState {
    if (this.openedAt === null) return 'closed';
    return this.halfOpen ? 'half_open' : 'open';
  }

  /** Test-only: force back to CLOSED. */
  reset(): void {
    this.failures = 0;
    this.openedAt = null;
    this.halfOpen = false;
  }
}

/** Shared breaker for the OpenRouter gateway (the app's single LLM provider). */
export const openRouterCircuitBreaker = new CircuitBreaker();

/** Pull an error code/type from OpenRouter's JSON error body (OpenAI-style
 *  `{"error":{"code","type","message"}}`). Used ONLY to refine classification
 *  (e.g. quota vs rate-limit); the body is never logged. */
function extractErrorCode(bodyText: string | undefined): string | null {
  if (!bodyText) return null;
  try {
    const j = JSON.parse(bodyText) as { error?: { code?: string | number; type?: string; message?: string } };
    const raw = j.error?.code ?? j.error?.type ?? null;
    return raw == null ? null : String(raw);
  } catch {
    return null;
  }
}

/** Pull the human-readable message from OpenRouter's error body (used ONLY to
 *  recognise a "response_format unsupported" error — the body is never surfaced). */
function extractErrorMessage(bodyText: string | undefined): string | null {
  if (!bodyText) return null;
  try {
    const j = JSON.parse(bodyText) as { error?: { message?: string } };
    return j.error?.message ?? null;
  } catch {
    return null;
  }
}

/** True when a 4xx body indicates the model rejected the sent `response_format`
 *  (e.g. "Model 'x' does not support 'json_object' response format. Supported
 *  formats: json_schema."). Drives the cross-mode fallback. */
export function isResponseFormatError(bodyText: string | undefined): boolean {
  const msg = (extractErrorMessage(bodyText) ?? bodyText ?? '').toLowerCase();
  if (!msg) return false;
  return (
    msg.includes('response_format') ||
    msg.includes('response format') ||
    ((msg.includes('json_object') || msg.includes('json_schema') || msg.includes('json schema')) &&
      (msg.includes('support') || msg.includes('supported')))
  );
}

/** Map an HTTP failure to a stable, key-safe LLMError. Codes follow OpenRouter's
 *  documented statuses: 401 invalid key, 402 insufficient credits, 429 rate
 *  limit / quota, 404 model not found. */
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
  else if (status === 402) code = 'insufficient_credits'; // OpenRouter: out of credits
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
 *  other error — and the exhausted rate-limit — is thrown for the caller. */
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
        '[ai-llm] retryable error — backing off',
      );
    }
  }
  logger.warn(
    { provider: lastErr?.provider, status: lastErr?.status, code: lastErr?.code },
    '[ai-llm] retries exhausted',
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
// OpenRouter client (OpenAI-compatible /chat/completions)
// ---------------------------------------------------------------------------

class OpenRouterLlmClient implements LlmClient {
  readonly name = OPENROUTER_PROVIDER;

  private readonly baseUrl: string;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    baseUrl: string,
    private readonly timeoutMs: number,
    private readonly maxTokens: number,
    private readonly siteUrl: string | null,
    private readonly appName: string | null,
    private readonly structuredOutputMode: StructuredOutputMode = 'auto',
  ) {
    // Defensive: guarantee the API root, so the endpoint is always exactly
    // `${root}/chat/completions` and never doubled/malformed.
    this.baseUrl = normalizeBaseUrl(baseUrl);
  }

  async complete(req: LlmCompletionRequest): Promise<string> {
    // Fail fast if the gateway is currently tripped (no wasted paid call).
    openRouterCircuitBreaker.assertClosed(this.name);
    try {
      const text = await this.completeWithFallback(req);
      openRouterCircuitBreaker.recordSuccess();
      return text;
    } catch (err) {
      // Only gateway-health failures trip the breaker; config errors (bad key,
      // no credits, unknown model) fail fast on their own and a cooldown can't fix.
      if (err instanceof LLMError && INFRA_FAILURE_CODES.has(err.code)) {
        openRouterCircuitBreaker.recordFailure();
      }
      throw err;
    }
  }

  /** Ordered structured-output modes to attempt for this request. The client tries
   *  the first; on an "unsupported response_format" error it advances to the next
   *  (json_schema ⇄ json_object, then prompt-only `none`). Selection honours the
   *  model's known capability (`structuredOutputMode`) and whether a schema exists. */
  private candidateModes(hasSchema: boolean): ConcreteMode[] {
    if (this.structuredOutputMode === 'none') return ['none'];
    // json_object-only models: try json_object first, but keep json_schema as a
    // fallback (satisfies "does not support json_object but supports json_schema").
    const order: ConcreteMode[] =
      this.structuredOutputMode === 'json_object'
        ? ['json_object', 'json_schema', 'none']
        : ['json_schema', 'json_object', 'none']; // 'auto' | 'json_schema'
    // json_schema needs a schema to send — drop it when none was provided.
    return order.filter((m) => (m === 'json_schema' ? hasSchema : true));
  }

  /** Build the `response_format` payload for one concrete mode (undefined = none). */
  private responseFormatFor(mode: ConcreteMode, schema: JsonSchemaSpec | undefined): unknown | undefined {
    if (mode === 'json_object') return { type: 'json_object' };
    if (mode === 'json_schema' && schema) {
      return {
        type: 'json_schema',
        json_schema: { name: schema.name, strict: schema.strict ?? true, schema: schema.schema },
      };
    }
    return undefined; // 'none' — prompt-only JSON
  }

  /** Try each candidate mode in order, advancing ONLY on an unsupported-format
   *  error; any other error (or exhausting the modes) is thrown to the caller. */
  private async completeWithFallback(req: LlmCompletionRequest): Promise<string> {
    const modes = this.candidateModes(Boolean(req.schema));
    let lastErr: unknown;
    for (let i = 0; i < modes.length; i++) {
      const mode = modes[i]!;
      try {
        return await retrying(() => this.request(req, mode));
      } catch (err) {
        lastErr = err;
        const next = modes[i + 1];
        const unsupported = err instanceof LLMError && err.code === 'unsupported_response_format';
        if (unsupported && next !== undefined) {
          logger.warn(
            { provider: this.name, model: this.model, requestedResponseFormat: mode, fallbackResponseFormat: next },
            '[ai-llm][openrouter] response_format unsupported — falling back',
          );
          continue;
        }
        throw err;
      }
    }
    throw lastErr ?? new LLMError(this.name, null, 'unsupported_response_format', false);
  }

  /** Bearer auth + OpenRouter's optional attribution headers (HTTP-Referer /
   *  X-Title). None of these carry user message content. */
  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${this.apiKey}`,
    };
    if (this.siteUrl) h['HTTP-Referer'] = this.siteUrl;
    if (this.appName) h['X-Title'] = this.appName;
    return h;
  }

  private async request(req: LlmCompletionRequest, mode: ConcreteMode): Promise<string> {
    const url = `${this.baseUrl}/chat/completions`;
    const responseFormat = this.responseFormatFor(mode, req.schema);
    // Without a response_format, lean on the prompt to force JSON (parsed + Zod-
    // validated on the backend regardless of mode).
    const system = responseFormat ? req.system : `${req.system}${JSON_ONLY_SUFFIX}`;
    const payload: Record<string, unknown> = {
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: req.user },
      ],
    };
    if (responseFormat) payload.response_format = responseFormat;

    logger.debug(
      { provider: this.name, model: this.model, responseFormat: mode },
      '[ai-llm][openrouter] chat/completions request',
    );

    let res: Response;
    try {
      res = await withTimeout(this.timeoutMs, (signal) =>
        fetch(url, {
          method: 'POST',
          signal,
          headers: this.headers(),
          body: JSON.stringify(payload),
        }),
      );
    } catch (err) {
      throw toTransportError(this.name, err);
    }

    if (!res.ok) {
      // Drain the error body — it carries OpenRouter's reason (no user messages,
      // no API key). Log rich diagnostics on failure so a 404 / format error is
      // debuggable: final URL, model, sent response_format, provider, request id,
      // and the raw provider error.
      const bodyText = await res.text().catch(() => undefined);
      const requestId = res.headers.get('x-request-id') ?? res.headers.get('cf-ray') ?? null;
      logger.warn(
        {
          caller: 'lib/llm/openrouter-client',
          method: 'POST',
          url,
          provider: this.name,
          model: this.model,
          status: res.status,
          requestedResponseFormat: mode,
          requestId,
          responseBody: bodyText?.slice(0, 500) ?? null,
        },
        '[ai-llm][openrouter] chat/completions request failed',
      );
      // A rejected response_format is recoverable — surface a dedicated code so the
      // caller (completeWithFallback) can retry with the next mode.
      if (mode !== 'none' && (res.status === 400 || res.status === 422) && isResponseFormatError(bodyText)) {
        throw new LLMError(this.name, res.status, 'unsupported_response_format', false);
      }
      throw classifyHttpError(this.name, res.status, bodyText, res.headers.get('retry-after'));
    }

    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content;
    // A 200 with no usable content is a malformed provider response.
    if (!text) throw new LLMError(this.name, res.status, 'malformed_response', false);
    return text;
  }
}

/** Build the OpenRouter client from config, or null when the LLM is
 *  disabled/unconfigured (no API key). */
export function createLlmClient(config: LlmConfig): LlmClient | null {
  if (!config.enabled || !config.apiKey) return null;
  return new OpenRouterLlmClient(
    config.apiKey,
    config.model,
    config.baseUrl,
    config.timeoutMs,
    config.maxTokens,
    config.siteUrl ?? null,
    config.appName ?? null,
    config.structuredOutputMode ?? 'auto',
  );
}
