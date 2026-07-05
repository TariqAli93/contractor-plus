import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidModelForProvider,
  normalizeModel,
  parseProvider,
  resolveBaseUrl,
} from '../../src/modules/voice/nlu/llm/voice-llm.config.js';
import {
  classifyHttpError,
  createLlmClient,
  LLMError,
  parseRetryAfter,
} from '../../src/modules/voice/nlu/llm/llm-client.js';

// ---- model normalization / validation -------------------------------------

test('normalizeModel: OpenAI-compatible providers trim + lowercase', () => {
  assert.equal(normalizeModel('openai', '  GPT-5.5 '), 'gpt-5.5');
  assert.equal(normalizeModel('openai', 'gpt-4o-mini'), 'gpt-4o-mini');
  assert.equal(normalizeModel('groq', '  Llama-3.3-70B-Versatile '), 'llama-3.3-70b-versatile');
});

test('normalizeModel: Anthropic only trims (case preserved)', () => {
  assert.equal(normalizeModel('anthropic', '  Claude-Haiku-4-5 '), 'Claude-Haiku-4-5');
});

test('isValidModelForProvider: valid OpenAI ids accepted', () => {
  for (const m of ['gpt-4o-mini', 'gpt-5.5', 'o1', 'o3-mini', 'chatgpt-4o-latest']) {
    assert.equal(isValidModelForProvider('openai', m), true, m);
  }
});

test('isValidModelForProvider: a bogus OpenAI id is rejected', () => {
  assert.equal(isValidModelForProvider('openai', 'davinci'), false);
  assert.equal(isValidModelForProvider('openai', 'claude-haiku-4-5'), false);
});

test('isValidModelForProvider: non-OpenAI providers accept anything', () => {
  assert.equal(isValidModelForProvider('anthropic', 'claude-haiku-4-5'), true);
  assert.equal(isValidModelForProvider('groq', 'llama-3.3-70b-versatile'), true);
  assert.equal(isValidModelForProvider('groq', 'whatever'), true);
});

// ---- provider + base URL resolution ---------------------------------------

test('parseProvider: recognizes openai/groq, defaults to anthropic', () => {
  assert.equal(parseProvider('openai'), 'openai');
  assert.equal(parseProvider(' GROQ '), 'groq');
  assert.equal(parseProvider('anthropic'), 'anthropic');
  assert.equal(parseProvider(undefined), 'anthropic');
  assert.equal(parseProvider('nonsense'), 'anthropic');
});

test('resolveBaseUrl: provider defaults, VOICE_LLM_BASE_URL overrides all', () => {
  const prev = process.env.VOICE_LLM_BASE_URL;
  delete process.env.VOICE_LLM_BASE_URL;
  try {
    assert.equal(resolveBaseUrl('openai'), 'https://api.openai.com/v1');
    assert.equal(resolveBaseUrl('anthropic'), 'https://api.anthropic.com/v1');
    assert.equal(resolveBaseUrl('groq'), 'https://api.groq.com/openai/v1');
    process.env.VOICE_LLM_BASE_URL = 'https://proxy.local/v1';
    assert.equal(resolveBaseUrl('openai'), 'https://proxy.local/v1');
    assert.equal(resolveBaseUrl('groq'), 'https://proxy.local/v1');
  } finally {
    if (prev === undefined) delete process.env.VOICE_LLM_BASE_URL;
    else process.env.VOICE_LLM_BASE_URL = prev;
  }
});

// ---- unified error classification -----------------------------------------

test('classifyHttpError: maps status → unified code + retryable (all providers)', () => {
  assert.equal(classifyHttpError('openai', 401, undefined, null).code, 'invalid_api_key');
  assert.equal(classifyHttpError('anthropic', 403, undefined, null).code, 'invalid_api_key');
  assert.equal(classifyHttpError('groq', 404, undefined, null).code, 'model_not_found');
  assert.equal(classifyHttpError('openai', 408, undefined, null).code, 'timeout');

  const rl = classifyHttpError('openai', 429, undefined, null);
  assert.equal(rl.code, 'rate_limited');
  assert.equal(rl.retryable, true);

  const quota = classifyHttpError('openai', 429, '{"error":{"code":"insufficient_quota"}}', null);
  assert.equal(quota.code, 'insufficient_quota');
  assert.equal(quota.retryable, false);

  const unavailable = classifyHttpError('groq', 503, undefined, null);
  assert.equal(unavailable.code, 'server_error');
  assert.equal(unavailable.retryable, true);

  assert.equal(classifyHttpError('openai', 500, undefined, null).code, 'server_error');
  assert.equal(classifyHttpError('openai', 500, undefined, null).retryable, false);
  assert.equal(classifyHttpError('openai', 418, undefined, null).code, 'unknown_error');
});

test('classifyHttpError: 429 honors Retry-After for backoff', () => {
  assert.equal(classifyHttpError('openai', 429, undefined, '2').retryAfterMs, 2000);
});

test('classifyHttpError: yields a real LLMError instance carrying provider/status', () => {
  const e = classifyHttpError('groq', 429, undefined, null);
  assert.ok(e instanceof LLMError);
  assert.equal(e.provider, 'groq');
  assert.equal(e.status, 429);
});

test('parseRetryAfter: seconds → ms, capped at 20s, invalid → null', () => {
  assert.equal(parseRetryAfter('2'), 2000);
  assert.equal(parseRetryAfter('0'), 0);
  assert.equal(parseRetryAfter('99999'), 20000);
  assert.equal(parseRetryAfter('abc'), null);
  assert.equal(parseRetryAfter(null), null);
});

// ---- retry/backoff over mocked fetch (Retry-After: 0 keeps it fast) --------

function makeClient(provider: 'openai' | 'groq' = 'openai') {
  return createLlmClient({
    enabled: true,
    provider,
    model: provider === 'groq' ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini',
    baseUrl: resolveBaseUrl(provider),
    apiKey: 'sk-test',
    timeoutMs: 2000,
    maxTokens: 8,
    minConfidence: 0.6,
  })!;
}

function mockFetchSequence(
  responses: Array<{ status: number; body?: string; headers?: Record<string, string> }>,
) {
  const orig = globalThis.fetch;
  let i = 0;
  globalThis.fetch = (async () => {
    const r = responses[Math.min(i, responses.length - 1)]!;
    i++;
    return new Response(r.body ?? '', { status: r.status, headers: r.headers });
  }) as typeof fetch;
  return {
    restore: () => {
      globalThis.fetch = orig;
    },
    count: () => i,
  };
}

test('429 → retries, then succeeds on a later attempt', async () => {
  const m = mockFetchSequence([
    { status: 429, headers: { 'retry-after': '0' } },
    { status: 429, headers: { 'retry-after': '0' } },
    { status: 200, body: JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }) },
  ]);
  try {
    const text = await makeClient().complete({ system: 's', user: 'u' });
    assert.equal(text, '{"ok":true}');
    assert.equal(m.count(), 3); // initial + 2 retries
  } finally {
    m.restore();
  }
});

test('persistent 429 → rate_limited after 3 retries', async () => {
  const m = mockFetchSequence([{ status: 429, headers: { 'retry-after': '0' } }]);
  try {
    await assert.rejects(
      () => makeClient().complete({ system: 's', user: 'u' }),
      (err: unknown) => err instanceof LLMError && err.code === 'rate_limited',
    );
    assert.equal(m.count(), 4); // initial + 3 retries, then give up
  } finally {
    m.restore();
  }
});

test('429 insufficient_quota is terminal — not retried', async () => {
  const m = mockFetchSequence([
    { status: 429, body: '{"error":{"code":"insufficient_quota"}}', headers: { 'retry-after': '0' } },
  ]);
  try {
    await assert.rejects(
      () => makeClient().complete({ system: 's', user: 'u' }),
      (err: unknown) => err instanceof LLMError && err.code === 'insufficient_quota',
    );
    assert.equal(m.count(), 1); // no retry
  } finally {
    m.restore();
  }
});

test('404 is terminal — never retried (model_not_found)', async () => {
  const m = mockFetchSequence([{ status: 404, body: '{"error":{"code":"model_not_found"}}' }]);
  try {
    await assert.rejects(
      () => makeClient().complete({ system: 's', user: 'u' }),
      (err: unknown) => err instanceof LLMError && err.code === 'model_not_found',
    );
    assert.equal(m.count(), 1); // no retry
  } finally {
    m.restore();
  }
});

test('Groq client shares the base retry/parse behavior (503 retried → content)', async () => {
  const m = mockFetchSequence([
    { status: 503, headers: { 'retry-after': '0' } },
    { status: 200, body: JSON.stringify({ choices: [{ message: { content: '{"ok":1}' } }] }) },
  ]);
  try {
    const text = await makeClient('groq').complete({ system: 's', user: 'u' });
    assert.equal(text, '{"ok":1}');
    assert.equal(m.count(), 2); // 503 retried, then success
  } finally {
    m.restore();
  }
});
