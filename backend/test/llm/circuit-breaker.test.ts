import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CircuitBreaker,
  openRouterCircuitBreaker,
  createLlmClient,
  LLMError,
} from '../../src/lib/llm/llm-client.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 1) Trips after the threshold, fails fast while open, recovers after cooldown.
test('circuit breaker trips at threshold, fails fast, then half-opens after cooldown', async () => {
  const cb = new CircuitBreaker(3, 30); // 3 failures, 30ms cooldown
  cb.assertClosed('openrouter'); // closed → no throw
  cb.recordFailure();
  cb.recordFailure();
  assert.equal(cb.state(), 'closed', '2 < 3 → still closed');
  cb.assertClosed('openrouter');
  cb.recordFailure(); // 3rd → open
  assert.equal(cb.state(), 'open');
  assert.throws(() => cb.assertClosed('openrouter'), (e) => e instanceof LLMError, 'open → fail fast');

  await sleep(45); // cooldown elapses
  cb.assertClosed('openrouter'); // half-open → the trial is allowed
  assert.equal(cb.state(), 'half_open');
  cb.recordSuccess(); // trial ok → closed
  assert.equal(cb.state(), 'closed');
  cb.assertClosed('openrouter');
});

// 2) A failed half-open trial re-opens immediately.
test('circuit breaker re-opens if the half-open trial fails', async () => {
  const cb = new CircuitBreaker(1, 20); // trips on a single failure
  cb.recordFailure();
  assert.throws(() => cb.assertClosed('openrouter'));
  await sleep(30);
  cb.assertClosed('openrouter'); // half-open (allowed)
  cb.recordFailure(); // trial failed → back to open
  assert.throws(() => cb.assertClosed('openrouter'), 'open again right away');
});

// 3) A success resets the consecutive-failure count.
test('circuit breaker success resets the failure streak', () => {
  const cb = new CircuitBreaker(3, 1000);
  cb.recordFailure();
  cb.recordFailure();
  cb.recordSuccess(); // reset
  cb.recordFailure();
  cb.recordFailure();
  cb.assertClosed('openrouter'); // only 2 since the reset → still closed
  assert.equal(cb.state(), 'closed');
});

// 4) Integration: the OpenRouter client trips the SHARED breaker after repeated
//    network failures, then short-circuits the next call without hitting fetch.
test('OpenRouter client opens the shared breaker and then fails fast', async () => {
  openRouterCircuitBreaker.reset();
  const realFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls++;
    throw new Error('ECONNREFUSED');
  }) as typeof fetch;
  try {
    const client = createLlmClient({
      enabled: true,
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
      baseUrl: 'http://127.0.0.1:9/api/v1',
      apiKey: 'k',
      timeoutMs: 500,
      maxTokens: 10,
    });
    assert.ok(client, 'client built');

    // Default threshold is 5 consecutive infra failures.
    for (let i = 0; i < 5; i++) {
      await client!.complete({ system: 's', user: 'u' }).catch(() => {});
    }
    const before = fetchCalls;
    assert.ok(before >= 5, 'the first five turns actually hit the network');

    // 6th turn: breaker OPEN → fail fast, no network call.
    await client!.complete({ system: 's', user: 'u' }).catch(() => {});
    assert.equal(fetchCalls, before, 'open breaker short-circuits — fetch not called again');
  } finally {
    globalThis.fetch = realFetch;
    openRouterCircuitBreaker.reset();
  }
});
