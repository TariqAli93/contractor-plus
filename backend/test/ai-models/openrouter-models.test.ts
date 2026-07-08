import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import {
  OpenRouterModelsService,
  mapModel,
  applyFilter,
  structuredOutputModeFor,
  __resetModelCacheForTests,
} from '../../src/lib/llm/openrouter-models.service.js';
import { classifyHttpError, createLlmClient, isResponseFormatError, LLMError } from '../../src/lib/llm/llm-client.js';
import { normalizeBaseUrl } from '../../src/lib/llm/llm.config.js';

// A minimal in-memory Prisma stand-in — only the two SystemSetting calls the
// model service touches. Lets us test caching without a database.
function fakePrisma(): PrismaClient {
  const store = new Map<string, unknown>();
  return {
    systemSetting: {
      upsert: async ({ where, create }: { where: { key: string }; create: { value: unknown } }) => {
        store.set(where.key, create.value);
        return {};
      },
      findUnique: async ({ where }: { where: { key: string } }) => {
        const value = store.get(where.key);
        return value === undefined ? null : { key: where.key, value };
      },
    },
  } as unknown as PrismaClient;
}

// A canned OpenRouter /models payload (the real endpoint returns { data: [...] }).
const CATALOG = {
  data: [
    {
      id: 'openai/gpt-4o-mini',
      name: 'OpenAI: GPT-4o-mini',
      context_length: 128000,
      architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
      pricing: { prompt: '0.00000015', completion: '0.0000006', request: '0', image: '0' },
      supported_parameters: ['tools', 'temperature'],
    },
    {
      id: 'meta-llama/llama-3.1-8b-instruct:free',
      name: 'Llama 3.1 8B (free)',
      context_length: 8192,
      architecture: { input_modalities: ['text'], output_modalities: ['text'] },
      pricing: { prompt: '0', completion: '0', request: '0', image: '0' },
      supported_parameters: ['temperature'],
    },
  ],
};

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: () => null },
  } as unknown as Response;
}

// 1) Fetch + map: the `data` array is projected to the safe DTO, free detected.
test('fetches and maps the OpenRouter model catalog', async () => {
  __resetModelCacheForTests();
  const svc = new OpenRouterModelsService(fakePrisma(), { fetchImpl: async () => okResponse(CATALOG) });
  const res = await svc.list();
  assert.equal(res.stale, false);
  assert.equal(res.models.length, 2);
  const mini = res.models.find((m) => m.id === 'openai/gpt-4o-mini');
  assert.ok(mini);
  assert.equal(mini?.contextLength, 128000);
  assert.equal(mini?.isFree, false);
  assert.deepEqual(mini?.inputModalities, ['text', 'image']);
  const free = res.models.find((m) => m.id.endsWith(':free'));
  assert.equal(free?.isFree, true);
});

// 2) Cache-on-failure: after a good fetch, a later failure serves the cache stale.
test('returns cached models when OpenRouter is unavailable', async () => {
  __resetModelCacheForTests();
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls === 1) return okResponse(CATALOG);
    throw new Error('network down');
  };
  // ttlMs:0 forces a refetch on the second call (which fails → stale cache).
  const svc = new OpenRouterModelsService(fakePrisma(), { fetchImpl, ttlMs: 0 });

  const first = await svc.list();
  assert.equal(first.stale, false);
  assert.equal(first.models.length, 2);

  const second = await svc.list();
  assert.equal(second.stale, true);
  assert.equal(second.models.length, 2); // same data, from cache
});

// 3) Capability filtering: tools / free / minContext.
test('filters models by capability', () => {
  const models = CATALOG.data.map(mapModel).filter((m): m is NonNullable<typeof m> => m !== null);
  assert.equal(applyFilter(models, { tools: true }).length, 1); // only gpt-4o-mini has tools
  assert.equal(applyFilter(models, { free: true }).length, 1); // only the :free model
  assert.equal(applyFilter(models, { input: 'image' }).length, 1); // only gpt-4o-mini takes images
  assert.equal(applyFilter(models, { minContext: 100000 }).length, 1);
  assert.equal(applyFilter(models, { search: 'llama' }).length, 1);
});

// 4) No cache + OpenRouter down → the failure surfaces as an LLMError.
test('throws when OpenRouter is down and nothing is cached', async () => {
  __resetModelCacheForTests();
  const svc = new OpenRouterModelsService(fakePrisma(), {
    fetchImpl: async () => {
      throw new Error('offline');
    },
  });
  await assert.rejects(() => svc.list(), (e) => e instanceof LLMError);
});

// 4b) Base URL is normalized to the API root — never doubled/suffixed, so the
//     final endpoint is always exactly `${root}/chat/completions`.
test('normalizes the OpenRouter base URL to the API root', () => {
  const root = 'https://openrouter.ai/api/v1';
  assert.equal(normalizeBaseUrl(root), root);
  assert.equal(normalizeBaseUrl('https://openrouter.ai/api/v1/'), root); // trailing slash
  assert.equal(normalizeBaseUrl('https://openrouter.ai/api/v1/models'), root); // wrong suffix
  assert.equal(normalizeBaseUrl('https://openrouter.ai/api/v1/chat/completions'), root); // wrong suffix
  assert.equal(normalizeBaseUrl('  https://openrouter.ai/api/v1//  '), root); // whitespace + double slash
});

// ---------------------------------------------------------------------------
// Structured-output capability + response_format fallback
// ---------------------------------------------------------------------------

// A catalog whose models advertise different structured-output support via
// `supported_parameters` (as OpenRouter really does).
const STRUCTURED_CATALOG = {
  data: [
    { id: 'openai/gpt-4o-mini', supported_parameters: ['response_format', 'structured_outputs', 'tools'] },
    { id: 'some/json-object-only', supported_parameters: ['response_format'] },
    { id: 'tencent/hy3:free', supported_parameters: ['structured_outputs'] },
    { id: 'legacy/no-json', supported_parameters: ['temperature'] },
  ],
};

// 6) supported_parameters → structured-output mode.
test('derives structured-output mode from supported_parameters', () => {
  assert.equal(structuredOutputModeFor(['structured_outputs', 'response_format']), 'json_schema');
  assert.equal(structuredOutputModeFor(['response_format']), 'json_object');
  assert.equal(structuredOutputModeFor(['temperature']), 'none');
  assert.equal(structuredOutputModeFor([]), 'none');
});

// 7) Cache-only peek resolves per-model capability (no live fetch on the hot path).
test('peekStructuredOutputMode reads capability from the cached catalog', async () => {
  __resetModelCacheForTests();
  const svc = new OpenRouterModelsService(fakePrisma(), { fetchImpl: async () => okResponse(STRUCTURED_CATALOG) });
  await svc.list(); // warm the cache
  assert.equal(await svc.peekStructuredOutputMode('tencent/hy3:free'), 'json_schema');
  assert.equal(await svc.peekStructuredOutputMode('some/json-object-only'), 'json_object');
  assert.equal(await svc.peekStructuredOutputMode('legacy/no-json'), 'none');
  assert.equal(await svc.peekStructuredOutputMode('unknown/model'), null); // absent → caller uses 'auto'
});

// 8) The "response_format unsupported" error body is recognised (drives fallback).
test('recognises response_format-unsupported error bodies', () => {
  assert.equal(
    isResponseFormatError(
      '{"error":{"message":"Model \'tencent/hy3\' does not support \'json_object\' response format. Supported formats: json_schema."}}',
    ),
    true,
  );
  assert.equal(isResponseFormatError('{"error":{"message":"rate limit exceeded"}}'), false);
  assert.equal(isResponseFormatError(undefined), false);
});

// ---- LLM client fallback (stubbing the global fetch the client uses) ----

interface CapturedRequest {
  responseFormatType: string | null;
  jsonSchemaName: string | null;
  system: string;
}

function stubFetch(handler: (req: CapturedRequest) => Response): {
  fetch: typeof fetch;
  calls: CapturedRequest[];
} {
  const calls: CapturedRequest[] = [];
  const fetchImpl = (async (_url: string, init: { body: string }) => {
    const payload = JSON.parse(init.body) as {
      response_format?: { type?: string; json_schema?: { name?: string } };
      messages: Array<{ role: string; content: string }>;
    };
    const req: CapturedRequest = {
      responseFormatType: payload.response_format?.type ?? null,
      jsonSchemaName: payload.response_format?.json_schema?.name ?? null,
      system: payload.messages.find((m) => m.role === 'system')?.content ?? '',
    };
    calls.push(req);
    return handler(req);
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, calls };
}

function completion(content: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => '',
    headers: { get: () => null },
  } as unknown as Response;
}

function formatError(): Response {
  const body =
    '{"error":{"message":"Model does not support \'json_object\' response format. Supported formats: json_schema."}}';
  return {
    ok: false,
    status: 400,
    json: async () => JSON.parse(body),
    text: async () => body,
    headers: { get: () => null },
  } as unknown as Response;
}

const SCHEMA = { name: 'test_schema', strict: false, schema: { type: 'object' } };

async function withStubbedFetch<T>(stub: typeof fetch, run: () => Promise<T>): Promise<T> {
  const orig = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await run();
  } finally {
    globalThis.fetch = orig;
  }
}

function clientForMode(mode: 'auto' | 'json_schema' | 'json_object' | 'none') {
  return createLlmClient({
    enabled: true,
    provider: 'openrouter',
    model: 'test/model',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: 'sk-test',
    timeoutMs: 10000,
    maxTokens: 100,
    structuredOutputMode: mode,
  })!;
}

// 9) auto + schema → json_schema is sent FIRST (fixes json_schema-only models).
test('auto mode with a schema sends json_schema first', async () => {
  const stub = stubFetch(() => completion('{"ok":true}'));
  const client = clientForMode('auto');
  const out = await withStubbedFetch(stub.fetch, () =>
    client.complete({ system: 'sys', user: 'u', schema: SCHEMA }),
  );
  assert.equal(out, '{"ok":true}');
  assert.equal(stub.calls.length, 1);
  assert.equal(stub.calls[0]?.responseFormatType, 'json_schema');
  assert.equal(stub.calls[0]?.jsonSchemaName, 'test_schema');
});

// 10) json_object-only model whose provider rejects json_object → falls back to
//     json_schema (the exact "unsupported json_object but supports json_schema" case).
test('falls back from json_object to json_schema on an unsupported-format error', async () => {
  let n = 0;
  const stub = stubFetch(() => (n++ === 0 ? formatError() : completion('{"ok":1}')));
  const client = clientForMode('json_object');
  const out = await withStubbedFetch(stub.fetch, () =>
    client.complete({ system: 'sys', user: 'u', schema: SCHEMA }),
  );
  assert.equal(out, '{"ok":1}');
  assert.equal(stub.calls.length, 2);
  assert.equal(stub.calls[0]?.responseFormatType, 'json_object');
  assert.equal(stub.calls[1]?.responseFormatType, 'json_schema');
});

// 11) none mode → no response_format is sent, and the JSON-only instruction is
//     appended to the system prompt (prompt-only degradation).
test('none mode sends no response_format and appends JSON-only instructions', async () => {
  const stub = stubFetch(() => completion('{}'));
  const client = clientForMode('none');
  await withStubbedFetch(stub.fetch, () => client.complete({ system: 'sys', user: 'u', schema: SCHEMA }));
  assert.equal(stub.calls.length, 1);
  assert.equal(stub.calls[0]?.responseFormatType, null); // no response_format field
  assert.match(stub.calls[0]?.system ?? '', /JSON object ONLY/);
});

// 12) When every structured mode is rejected, the final error surfaces cleanly.
test('surfaces unsupported_response_format when all modes are rejected', async () => {
  // Every attempt fails (even the prompt-only 'none' fallback) → a clean LLMError.
  const stub = stubFetch(() => formatError());
  const client = clientForMode('json_object');
  await withStubbedFetch(stub.fetch, async () => {
    await assert.rejects(
      () => client.complete({ system: 'sys', user: 'u' }), // no schema → [json_object, none]
      (e) => e instanceof LLMError,
    );
  });
});

// 5) Error classification covers the OpenRouter-specific statuses.
test('classifies OpenRouter HTTP errors', () => {
  assert.equal(classifyHttpError('openrouter', 401, undefined, null).code, 'invalid_api_key');
  assert.equal(classifyHttpError('openrouter', 402, undefined, null).code, 'insufficient_credits');
  assert.equal(classifyHttpError('openrouter', 404, undefined, null).code, 'model_not_found');
  assert.equal(classifyHttpError('openrouter', 429, undefined, null).code, 'rate_limited');
  assert.equal(classifyHttpError('openrouter', 429, undefined, null).retryable, true);
  assert.equal(
    classifyHttpError('openrouter', 429, '{"error":{"code":"insufficient_quota"}}', null).code,
    'insufficient_quota',
  );
});
