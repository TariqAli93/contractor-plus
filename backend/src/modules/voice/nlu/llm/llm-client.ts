// ============================================================
// LLM client — the provider-agnostic transport (Anthropic / OpenAI).
//
// A thin HTTP boundary: given a system + user prompt, return the model's TEXT.
// No domain knowledge, no DB, no Services. Adding a provider = one more adapter
// implementing LlmClient; nothing else changes. Every call is hard-bounded by a
// timeout so a slow/down provider degrades to RuleBased instead of hanging.
// ============================================================

import type { LlmProviderName, VoiceLlmConfig } from './voice-llm.config.js';

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
    return withTimeout(this.timeoutMs, async (signal) => {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: this.maxTokens,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
        }),
      });
      if (!res.ok) {
        // Read (and discard) the error body so the socket frees promptly; it may
        // carry OpenAI's reason but never the API key, and we never log it. Then
        // surface a stable, understandable code.
        await res.text().catch(() => undefined);
        throw new Error(mapOpenAiStatus(res.status));
      }
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw new Error('openai_empty_response');
      return text;
    });
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
