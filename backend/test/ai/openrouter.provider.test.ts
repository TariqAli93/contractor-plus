/**
 * Unit tests for the OpenRouter provider — the ONLY AiProvider implementation.
 * Pure unit level (injected fake fetch): request shape (endpoint, headers,
 * body), usage extraction, and the HTTP→AppError translation table. No DB, no
 * network, no env.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { OpenRouterProvider } from '../../src/lib/ai/openrouter.provider.js';
import type { AiRuntimeConfig } from '../../src/lib/ai/ai-config.js';
import { RateLimitedError } from '../../src/shared/errors/rate-limited.error.js';
import { TimeoutError } from '../../src/shared/errors/timeout.error.js';
import { UpstreamError } from '../../src/shared/errors/upstream.error.js';

const CONFIG: AiRuntimeConfig = {
  apiKey: 'sk-or-test',
  baseUrl: 'https://openrouter.test/api/v1',
  modelDefault: 'test/default-model',
  modelHeavy: 'test/heavy-model',
  appUrl: 'https://contractor.example',
  appTitle: 'Contractor Plus',
  timeoutMs: 5_000,
};

const OK_BODY = {
  model: 'test/default-model',
  choices: [{ message: { role: 'assistant', content: 'جاهز' } }],
  usage: { prompt_tokens: 42, completion_tokens: 7 },
};

interface Captured {
  url: string;
  init: RequestInit;
}

/** Provider wired to a fake fetch returning `response`; captures the request. */
function makeProvider(response: Response, captured?: Captured[]): OpenRouterProvider {
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    captured?.push({ url: String(url), init: init ?? {} });
    return response;
  }) as typeof fetch;
  return new OpenRouterProvider(CONFIG, { fetchImpl });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('success: parses content, echoed model and usage', async () => {
  const provider = makeProvider(jsonResponse(OK_BODY));
  const result = await provider.complete({
    model: 'test/default-model',
    messages: [{ role: 'user', content: 'قل: جاهز' }],
  });
  assert.equal(result.content, 'جاهز');
  assert.equal(result.modelUsed, 'test/default-model');
  assert.deepEqual(result.usage, { promptTokens: 42, completionTokens: 7 });
});

test('request shape: endpoint, auth + attribution headers, OpenAI-compatible body', async () => {
  const captured: Captured[] = [];
  const provider = makeProvider(jsonResponse(OK_BODY), captured);
  await provider.complete({
    model: 'test/default-model',
    messages: [
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
    ],
    temperature: 0.5,
    maxTokens: 99,
  });

  assert.equal(captured.length, 1);
  const { url, init } = captured[0]!;
  assert.equal(url, 'https://openrouter.test/api/v1/chat/completions');
  assert.equal(init.method, 'POST');

  const headers = init.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer sk-or-test');
  assert.equal(headers['Content-Type'], 'application/json');
  assert.equal(headers['HTTP-Referer'], 'https://contractor.example');
  assert.equal(headers['X-Title'], 'Contractor Plus');

  const body = JSON.parse(String(init.body)) as Record<string, unknown>;
  assert.equal(body.model, 'test/default-model');
  assert.deepEqual(body.messages, [
    { role: 'system', content: 's' },
    { role: 'user', content: 'u' },
  ]);
  assert.equal(body.temperature, 0.5);
  assert.equal(body.max_tokens, 99);
  // No structured output requested → no response_format key at all.
  assert.ok(!('response_format' in body));
});

test('attribution headers are omitted when appUrl/appTitle are not configured', async () => {
  const captured: Captured[] = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    captured.push({ url: String(url), init: init ?? {} });
    return jsonResponse(OK_BODY);
  }) as typeof fetch;
  const provider = new OpenRouterProvider(
    { ...CONFIG, appUrl: undefined, appTitle: undefined },
    { fetchImpl },
  );
  await provider.complete({ model: 'm', messages: [{ role: 'user', content: 'u' }] });
  const headers = captured[0]!.init.headers as Record<string, string>;
  assert.ok(!('HTTP-Referer' in headers));
  assert.ok(!('X-Title' in headers));
});

test('responseFormat json_object is forwarded as response_format', async () => {
  const captured: Captured[] = [];
  const provider = makeProvider(jsonResponse(OK_BODY), captured);
  await provider.complete({
    model: 'test/default-model',
    messages: [{ role: 'user', content: 'u' }],
    responseFormat: 'json_object',
  });
  const body = JSON.parse(String(captured[0]!.init.body)) as Record<string, unknown>;
  assert.deepEqual(body.response_format, { type: 'json_object' });
});

test('missing usage block → zero token counts (never NaN)', async () => {
  const provider = makeProvider(
    jsonResponse({ choices: [{ message: { content: 'ok' } }] }),
  );
  const result = await provider.complete({
    model: 'test/default-model',
    messages: [{ role: 'user', content: 'u' }],
  });
  assert.deepEqual(result.usage, { promptTokens: 0, completionTokens: 0 });
  // Model falls back to the requested slug when the response omits it.
  assert.equal(result.modelUsed, 'test/default-model');
});

test('empty/missing completion content → UpstreamError AI_PROVIDER_BAD_RESPONSE', async () => {
  const provider = makeProvider(jsonResponse({ choices: [] }));
  await assert.rejects(
    provider.complete({ model: 'm', messages: [{ role: 'user', content: 'u' }] }),
    (err: unknown) => err instanceof UpstreamError && err.code === 'AI_PROVIDER_BAD_RESPONSE',
  );
});

test('402 (credits exhausted) → UpstreamError AI_CREDITS_EXHAUSTED, retryable 502', async () => {
  const provider = makeProvider(jsonResponse({ error: { message: 'Insufficient credits' } }, 402));
  await assert.rejects(
    provider.complete({ model: 'm', messages: [{ role: 'user', content: 'u' }] }),
    (err: unknown) =>
      err instanceof UpstreamError &&
      err.code === 'AI_CREDITS_EXHAUSTED' &&
      err.statusCode === 502 &&
      err.retryable === true,
  );
});

test('401 → UpstreamError AI_PROVIDER_REJECTED', async () => {
  const provider = makeProvider(jsonResponse({ error: { message: 'Invalid key' } }, 401));
  await assert.rejects(
    provider.complete({ model: 'm', messages: [{ role: 'user', content: 'u' }] }),
    (err: unknown) => err instanceof UpstreamError && err.code === 'AI_PROVIDER_REJECTED',
  );
});

test('429 → RateLimitedError AI_RATE_LIMITED (429 on the wire)', async () => {
  const provider = makeProvider(jsonResponse({ error: { message: 'slow down' } }, 429));
  await assert.rejects(
    provider.complete({ model: 'm', messages: [{ role: 'user', content: 'u' }] }),
    (err: unknown) =>
      err instanceof RateLimitedError && err.code === 'AI_RATE_LIMITED' && err.statusCode === 429,
  );
});

test('500 from OpenRouter → UpstreamError AI_PROVIDER_ERROR carrying the status', async () => {
  const provider = makeProvider(jsonResponse({ error: { message: 'boom' } }, 500));
  await assert.rejects(
    provider.complete({ model: 'm', messages: [{ role: 'user', content: 'u' }] }),
    (err: unknown) =>
      err instanceof UpstreamError &&
      err.code === 'AI_PROVIDER_ERROR' &&
      (err.details as { status: number }).status === 500,
  );
});

test('timeout abort → TimeoutError UPSTREAM_TIMEOUT (504, retryable)', async () => {
  const fetchImpl = (async () => {
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  }) as unknown as typeof fetch;
  const provider = new OpenRouterProvider(CONFIG, { fetchImpl });
  await assert.rejects(
    provider.complete({ model: 'm', messages: [{ role: 'user', content: 'u' }] }),
    (err: unknown) =>
      err instanceof TimeoutError && err.code === 'UPSTREAM_TIMEOUT' && err.retryable === true,
  );
});

test('network failure → UpstreamError PROVIDER_DOWN', async () => {
  const fetchImpl = (async () => {
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;
  const provider = new OpenRouterProvider(CONFIG, { fetchImpl });
  await assert.rejects(
    provider.complete({ model: 'm', messages: [{ role: 'user', content: 'u' }] }),
    (err: unknown) => err instanceof UpstreamError && err.code === 'PROVIDER_DOWN',
  );
});

test('non-JSON success body → UpstreamError AI_PROVIDER_BAD_RESPONSE', async () => {
  const provider = makeProvider(new Response('<html>gateway</html>', { status: 200 }));
  await assert.rejects(
    provider.complete({ model: 'm', messages: [{ role: 'user', content: 'u' }] }),
    (err: unknown) => err instanceof UpstreamError && err.code === 'AI_PROVIDER_BAD_RESPONSE',
  );
});
