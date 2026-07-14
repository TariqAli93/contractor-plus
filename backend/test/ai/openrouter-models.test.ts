/**
 * Tests for the OpenRouter models fetcher/classifier: it surfaces EVERY
 * provider (no Anthropic-only filtering), drops non-text and expired models,
 * detects free models by slug OR zero pricing (strings or numbers), sorts free
 * first, and falls back /models/user → /models. Never a hardcoded list.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchOpenRouterModels } from '../../src/lib/ai/openrouter-models.js';
import { UpstreamError } from '../../src/shared/errors/upstream.error.js';

const BASE = 'https://openrouter.test/api/v1';

function jsonResponse(status: number, body: unknown): Response {
  return { status, json: async () => body } as unknown as Response;
}

/** A fake fetch that matches by URL suffix. */
function fetchMap(map: Record<string, Response>): typeof fetch {
  return (async (url: string | URL) => {
    const u = url.toString();
    const hit = Object.keys(map).find((k) => u.endsWith(k));
    if (!hit) throw new Error(`unexpected url ${u}`);
    return map[hit]!;
  }) as unknown as typeof fetch;
}

function userModels(data: unknown[]): typeof fetch {
  return fetchMap({ '/models/user': jsonResponse(200, { data }) });
}

test('surfaces models from EVERY provider — no Anthropic-only filtering', async () => {
  const fetchImpl = userModels([
    { id: 'openai/gpt-5', name: 'OpenAI: GPT-5', pricing: { prompt: '0.000005', completion: '0.00001' } },
    { id: 'anthropic/claude-sonnet-4.6', name: 'Anthropic: Claude Sonnet 4.6', pricing: { prompt: '0.000003' } },
    { id: 'google/gemini-2.5-flash', name: 'Google: Gemini 2.5 Flash', pricing: { prompt: '0.00000015' } },
    { id: 'meta-llama/llama-3.1-70b', name: 'Meta: Llama 3.1 70B', pricing: { prompt: '0.0000004' } },
    { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat', pricing: { prompt: '0.0000002' } },
    { id: 'qwen/qwen-2.5-72b', name: 'Qwen 2.5 72B', pricing: { prompt: '0.0000003' } },
    { id: 'mistralai/mistral-large', name: 'Mistral Large', pricing: { prompt: '0.000002' } },
  ]);
  const models = await fetchOpenRouterModels('sk-or-x', { baseUrl: BASE, fetchImpl });
  const providers = new Set(models.map((m) => m.provider));
  for (const p of ['openai', 'anthropic', 'google', 'meta-llama', 'deepseek', 'qwen', 'mistralai']) {
    assert.ok(providers.has(p), `expected provider ${p}`);
  }
  assert.equal(models.length, 7);
});

test('provider is derived from the slug head, not hardcoded', async () => {
  const models = await fetchOpenRouterModels('k', {
    baseUrl: BASE,
    fetchImpl: userModels([{ id: 'x-ai/grok-4', pricing: { prompt: '0.00001' } }]),
  });
  assert.equal(models[0]!.provider, 'x-ai');
});

test('drops non-text models (image-only output)', async () => {
  const models = await fetchOpenRouterModels('k', {
    baseUrl: BASE,
    fetchImpl: userModels([
      { id: 'a/text', pricing: { prompt: '0.001' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
      { id: 'b/image-out', pricing: { prompt: '0.001' }, architecture: { input_modalities: ['text'], output_modalities: ['image'] } },
      { id: 'c/audio-in', pricing: { prompt: '0.001' }, architecture: { input_modalities: ['audio'], output_modalities: ['text'] } },
    ]),
  });
  const ids = models.map((m) => m.id);
  assert.deepEqual(ids, ['a/text']);
});

test('keeps a model when modality info is absent (assume text, avoid over-filtering)', async () => {
  const models = await fetchOpenRouterModels('k', {
    baseUrl: BASE,
    fetchImpl: userModels([{ id: 'a/unknown-modality', pricing: { prompt: '0.001' } }]),
  });
  assert.equal(models.length, 1);
});

test('drops expired models (past expiration_date) but keeps future ones', async () => {
  const models = await fetchOpenRouterModels('k', {
    baseUrl: BASE,
    fetchImpl: userModels([
      { id: 'a/expired', pricing: { prompt: '0' }, expiration_date: '2000-01-01T00:00:00Z' },
      { id: 'b/live', pricing: { prompt: '0' }, expiration_date: '2999-01-01T00:00:00Z' },
    ]),
  });
  assert.deepEqual(models.map((m) => m.id), ['b/live']);
});

test('free detection: :free suffix', async () => {
  const models = await fetchOpenRouterModels('k', {
    baseUrl: BASE,
    fetchImpl: userModels([{ id: 'deepseek/deepseek-r1:free', pricing: { prompt: '0.001', completion: '0.002' } }]),
  });
  assert.equal(models[0]!.isFree, true); // slug wins even if pricing looks paid
});

test('free detection: openrouter/free special slug', async () => {
  const models = await fetchOpenRouterModels('k', {
    baseUrl: BASE,
    fetchImpl: userModels([{ id: 'openrouter/free', pricing: { prompt: '0.5' } }]),
  });
  assert.equal(models[0]!.isFree, true);
});

test('free detection: all-zero pricing as STRINGS', async () => {
  const models = await fetchOpenRouterModels('k', {
    baseUrl: BASE,
    fetchImpl: userModels([{ id: 'x/zero-str', pricing: { prompt: '0', completion: '0', request: '0' } }]),
  });
  assert.equal(models[0]!.isFree, true);
});

test('free detection: all-zero pricing as NUMBERS', async () => {
  const models = await fetchOpenRouterModels('k', {
    baseUrl: BASE,
    fetchImpl: userModels([{ id: 'x/zero-num', pricing: { prompt: 0, completion: 0, request: 0 } }]),
  });
  assert.equal(models[0]!.isFree, true);
});

test('a paid model is NOT flagged free; price/M is computed (string price)', async () => {
  const models = await fetchOpenRouterModels('k', {
    baseUrl: BASE,
    fetchImpl: userModels([{ id: 'x/paid', pricing: { prompt: '0.0000015', completion: '0.000006' } }]),
  });
  assert.equal(models[0]!.isFree, false);
  assert.ok(Math.abs(models[0]!.promptPricePerMillion! - 1.5) < 1e-9);
  assert.ok(Math.abs(models[0]!.completionPricePerMillion! - 6) < 1e-9);
});

test('sorts free models first, then alphabetically within each group', async () => {
  const models = await fetchOpenRouterModels('k', {
    baseUrl: BASE,
    fetchImpl: userModels([
      { id: 'z/paid', name: 'Zeta Paid', pricing: { prompt: '0.001' } },
      { id: 'a/paid', name: 'Alpha Paid', pricing: { prompt: '0.001' } },
      { id: 'm/free', name: 'Mid Free', pricing: { prompt: '0' } },
      { id: 'b/free', name: 'Beta Free', pricing: { prompt: '0' } },
    ]),
  });
  assert.deepEqual(
    models.map((m) => m.displayName),
    ['Beta Free', 'Mid Free', 'Alpha Paid', 'Zeta Paid'],
  );
});

test('maps tool + structured-output capabilities from supported_parameters', async () => {
  const models = await fetchOpenRouterModels('k', {
    baseUrl: BASE,
    fetchImpl: userModels([
      { id: 'a/tools', pricing: { prompt: '0.001' }, supported_parameters: ['tools', 'tool_choice', 'response_format'] },
      { id: 'b/plain', pricing: { prompt: '0.001' }, supported_parameters: ['temperature'] },
    ]),
  });
  const byId = Object.fromEntries(models.map((m) => [m.id, m]));
  assert.equal(byId['a/tools']!.supportsTools, true);
  assert.equal(byId['a/tools']!.supportsStructuredOutput, true);
  assert.equal(byId['b/plain']!.supportsTools, false);
  assert.equal(byId['b/plain']!.supportsStructuredOutput, false);
});

test('skips an unparseable row (no id) but keeps the valid ones', async () => {
  const models = await fetchOpenRouterModels('k', {
    baseUrl: BASE,
    fetchImpl: userModels([{ name: 'no id here' }, { id: 'good/model', pricing: { prompt: '0.001' } }]),
  });
  assert.deepEqual(models.map((m) => m.id), ['good/model']);
});

test('falls back /models/user → /models when the user endpoint is 404', async () => {
  const fetchImpl = fetchMap({
    '/models/user': jsonResponse(404, null),
    '/models': jsonResponse(200, { data: [{ id: 'openai/gpt-5', pricing: { prompt: '0.001' } }] }),
  });
  const models = await fetchOpenRouterModels('k', { baseUrl: BASE, fetchImpl });
  assert.deepEqual(models.map((m) => m.id), ['openai/gpt-5']);
});

test('does NOT double /api/v1 — base is used verbatim (trailing slash trimmed)', async () => {
  const seen: string[] = [];
  const fetchImpl = (async (url: string | URL) => {
    seen.push(url.toString());
    return jsonResponse(200, { data: [] });
  }) as unknown as typeof fetch;
  await fetchOpenRouterModels('k', { baseUrl: 'https://openrouter.test/api/v1/', fetchImpl });
  assert.equal(seen[0], 'https://openrouter.test/api/v1/models/user');
});

test('a rejected key (401) throws AI_PROVIDER_REJECTED', async () => {
  const fetchImpl = fetchMap({ '/models/user': jsonResponse(401, { error: 'no' }) });
  await assert.rejects(
    fetchOpenRouterModels('bad', { baseUrl: BASE, fetchImpl }),
    (e: unknown) => e instanceof UpstreamError && e.code === 'AI_PROVIDER_REJECTED',
  );
});
