import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidModelForProvider,
  normalizeModel,
} from '../../src/modules/voice/nlu/llm/voice-llm.config.js';
import {
  createLlmClient,
  mapOpenAiStatus,
  parseRetryAfter,
} from '../../src/modules/voice/nlu/llm/llm-client.js';

test('normalizeModel: OpenAI trims + lowercases ("GPT-5.5" → "gpt-5.5")', () => {
  assert.equal(normalizeModel('openai', '  GPT-5.5 '), 'gpt-5.5');
  assert.equal(normalizeModel('openai', 'gpt-4o-mini'), 'gpt-4o-mini');
  assert.equal(normalizeModel('openai', 'O1-Mini'), 'o1-mini');
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

test('isValidModelForProvider: Anthropic accepts anything (case-sensitive ids)', () => {
  assert.equal(isValidModelForProvider('anthropic', 'claude-haiku-4-5'), true);
  assert.equal(isValidModelForProvider('anthropic', 'Whatever'), true);
});

test('mapOpenAiStatus: understandable codes for 401/404/429, raw code otherwise', () => {
  assert.equal(mapOpenAiStatus(401), 'openai_invalid_api_key');
  assert.equal(mapOpenAiStatus(404), 'openai_model_not_found_or_not_available');
  assert.equal(mapOpenAiStatus(429), 'openai_rate_limited');
  assert.equal(mapOpenAiStatus(500), 'openai_http_500');
});

test('parseRetryAfter: seconds → ms, capped at 20s, invalid → null', () => {
  assert.equal(parseRetryAfter('2'), 2000);
  assert.equal(parseRetryAfter('0'), 0);
  assert.equal(parseRetryAfter('99999'), 20000);
  assert.equal(parseRetryAfter('abc'), null);
  assert.equal(parseRetryAfter(null), null);
});

// ---- OpenAI 429 retry/backoff (mocked fetch; Retry-After: 0 keeps it fast) ----

function makeOpenAiClient() {
  return createLlmClient({
    enabled: true,
    provider: 'openai',
    model: 'gpt-4o-mini',
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

test('OpenAI 429 → retries, then succeeds on a later attempt', async () => {
  const m = mockFetchSequence([
    { status: 429, headers: { 'retry-after': '0' } },
    { status: 429, headers: { 'retry-after': '0' } },
    { status: 200, body: JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }) },
  ]);
  try {
    const text = await makeOpenAiClient().complete({ system: 's', user: 'u' });
    assert.equal(text, '{"ok":true}');
    assert.equal(m.count(), 3); // initial + 2 retries
  } finally {
    m.restore();
  }
});

test('OpenAI persistent 429 → openai_rate_limited after 3 retries', async () => {
  const m = mockFetchSequence([{ status: 429, headers: { 'retry-after': '0' } }]);
  try {
    await assert.rejects(
      () => makeOpenAiClient().complete({ system: 's', user: 'u' }),
      /openai_rate_limited/,
    );
    assert.equal(m.count(), 4); // initial + 3 retries, then give up
  } finally {
    m.restore();
  }
});

test('OpenAI 404 is terminal — never retried', async () => {
  const m = mockFetchSequence([{ status: 404, body: '{"error":"model_not_found"}' }]);
  try {
    await assert.rejects(
      () => makeOpenAiClient().complete({ system: 's', user: 'u' }),
      /openai_model_not_found_or_not_available/,
    );
    assert.equal(m.count(), 1); // no retry
  } finally {
    m.restore();
  }
});
