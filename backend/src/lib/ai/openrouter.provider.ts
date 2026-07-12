import { RateLimitedError } from '../../shared/errors/rate-limited.error.js';
import { TimeoutError } from '../../shared/errors/timeout.error.js';
import { UpstreamError } from '../../shared/errors/upstream.error.js';
import type {
  AiCompletionInput,
  AiCompletionResult,
  AiProvider,
} from './ai-provider.interface.js';
import type { AiRuntimeConfig } from './ai-config.js';

// The ONLY AiProvider implementation — every model call in this project goes
// through OpenRouter's OpenAI-compatible /chat/completions endpoint. No other
// provider SDK or endpoint is permitted (binding rule #6).

const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 1500;

export interface OpenRouterProviderOptions {
  /** Injectable for unit tests only; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/** Minimal shape of a successful OpenRouter chat-completions response. */
interface OpenRouterCompletionResponse {
  model?: string;
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}

export class OpenRouterProvider implements AiProvider {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly config: AiRuntimeConfig,
    options: OpenRouterProviderOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async complete(input: AiCompletionInput): Promise<AiCompletionResult> {
    const response = await this.request(input);
    if (!response.ok) throw await this.toError(response);

    let payload: OpenRouterCompletionResponse;
    try {
      payload = (await response.json()) as OpenRouterCompletionResponse;
    } catch {
      throw new UpstreamError('OpenRouter returned a non-JSON response', 'AI_PROVIDER_BAD_RESPONSE');
    }

    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      throw new UpstreamError('OpenRouter response has no completion content', 'AI_PROVIDER_BAD_RESPONSE');
    }

    return {
      content,
      modelUsed: typeof payload.model === 'string' && payload.model ? payload.model : input.model,
      usage: {
        promptTokens: toTokenCount(payload.usage?.prompt_tokens),
        completionTokens: toTokenCount(payload.usage?.completion_tokens),
      },
    };
  }

  private async request(input: AiCompletionInput): Promise<Response> {
    const { apiKey, baseUrl, appUrl, appTitle, timeoutMs } = this.config;
    try {
      return await this.fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...(appUrl ? { 'HTTP-Referer': appUrl } : {}),
          ...(appTitle ? { 'X-Title': appTitle } : {}),
        },
        body: JSON.stringify({
          model: input.model,
          messages: input.messages,
          temperature: input.temperature ?? DEFAULT_TEMPERATURE,
          max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
          ...(input.responseFormat === 'json_object'
            ? { response_format: { type: 'json_object' } }
            : {}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // AbortSignal.timeout aborts with a DOMException named TimeoutError
      // (AbortError on some undici versions).
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        throw new TimeoutError('OpenRouter request timed out', 'UPSTREAM_TIMEOUT');
      }
      throw new UpstreamError('OpenRouter is unreachable', 'PROVIDER_DOWN');
    }
  }

  /** Map an HTTP error status to the app error family (never leaks the body). */
  private async toError(response: Response): Promise<Error> {
    // Body is drained for the provider's error message — logged upstream via
    // the 5xx handler, but only the status is ever serialized to the client.
    const providerMessage = await readProviderMessage(response);
    const details = { status: response.status };
    switch (response.status) {
      case 401:
      case 403:
        return new UpstreamError('OpenRouter rejected the API key', 'AI_PROVIDER_REJECTED', details);
      case 402:
        return new UpstreamError('OpenRouter credits are exhausted', 'AI_CREDITS_EXHAUSTED', details);
      case 429:
        return new RateLimitedError('OpenRouter rate limit reached', 'AI_RATE_LIMITED', details);
      default:
        return new UpstreamError(
          `OpenRouter request failed (${response.status}${providerMessage ? `: ${providerMessage}` : ''})`,
          'AI_PROVIDER_ERROR',
          details,
        );
    }
  }
}

function toTokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

/** Best-effort extraction of OpenRouter's `error.message` — never throws. */
async function readProviderMessage(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    const message = body.error?.message;
    return typeof message === 'string' && message.length > 0 ? message.slice(0, 200) : undefined;
  } catch {
    return undefined;
  }
}
