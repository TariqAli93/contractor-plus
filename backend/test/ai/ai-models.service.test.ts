/**
 * Tests for AiModelsService — the key-scoped, short-lived cache over the live
 * catalogue: cache hits, forced refresh, TTL expiry, invalidation on key
 * change, stale fallback on a failed refresh, and best-effort capability reads.
 * A cached list is NEVER reused across different keys.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiModelListItem } from '@contractor-plus/shared';

import { AiModelsService } from '../../src/modules/ai-assistant/services/ai-models.service.js';

const BASE = 'https://openrouter.test/api/v1';

function model(id: string, over: Partial<AiModelListItem> = {}): AiModelListItem {
  return {
    id,
    name: id,
    provider: id.split('/')[0]!,
    displayName: id,
    isFree: false,
    contextLength: 1000,
    promptPricePerMillion: 1,
    completionPricePerMillion: 1,
    supportsTools: true,
    supportsStructuredOutput: true,
    ...over,
  };
}

test('cache hit — a second list() for the same key does NOT refetch', async () => {
  let calls = 0;
  const svc = new AiModelsService({
    baseUrl: BASE,
    fetcher: async () => {
      calls++;
      return [model('a/one')];
    },
  });
  await svc.list('sk-or-A');
  const second = await svc.list('sk-or-A');
  assert.equal(calls, 1);
  assert.equal(second.stale, false);
  assert.equal(second.items[0]!.id, 'a/one');
});

test('force refresh bypasses the cache', async () => {
  let calls = 0;
  const svc = new AiModelsService({
    baseUrl: BASE,
    fetcher: async () => {
      calls++;
      return [model('a/one')];
    },
  });
  await svc.list('sk-or-A');
  await svc.list('sk-or-A', { refresh: true });
  assert.equal(calls, 2);
});

test('TTL expiry triggers a refetch', async () => {
  let calls = 0;
  let clock = 1000;
  const svc = new AiModelsService({
    baseUrl: BASE,
    ttlMs: 500,
    now: () => clock,
    fetcher: async () => {
      calls++;
      return [model('a/one')];
    },
  });
  await svc.list('sk-or-A'); // fetch 1
  clock += 200;
  await svc.list('sk-or-A'); // still fresh
  assert.equal(calls, 1);
  clock += 400; // now past the 500ms TTL
  await svc.list('sk-or-A'); // fetch 2
  assert.equal(calls, 2);
});

test('a different key never gets served another key\'s cached list', async () => {
  const byKey: Record<string, string> = { 'sk-or-A': 'a/from-A', 'sk-or-B': 'b/from-B' };
  let calls = 0;
  const svc = new AiModelsService({
    baseUrl: BASE,
    fetcher: async (rawKey) => {
      calls++;
      return [model(byKey[rawKey]!)];
    },
  });
  const a = await svc.list('sk-or-A');
  const b = await svc.list('sk-or-B');
  assert.equal(a.items[0]!.id, 'a/from-A');
  assert.equal(b.items[0]!.id, 'b/from-B'); // NOT A's list
  assert.equal(calls, 2);
});

test('invalidate() forces the next list() to refetch (key-change behaviour)', async () => {
  let calls = 0;
  const svc = new AiModelsService({
    baseUrl: BASE,
    fetcher: async () => {
      calls++;
      return [model('a/one')];
    },
  });
  await svc.list('sk-or-A');
  svc.invalidate();
  await svc.list('sk-or-A');
  assert.equal(calls, 2);
});

test('failed refresh serves the previous list for the SAME key, marked stale', async () => {
  let calls = 0;
  const svc = new AiModelsService({
    baseUrl: BASE,
    fetcher: async () => {
      calls++;
      if (calls === 1) return [model('a/one')];
      throw new Error('openrouter down');
    },
  });
  await svc.list('sk-or-A'); // warm
  const stale = await svc.list('sk-or-A', { refresh: true }); // fetch fails
  assert.equal(stale.stale, true);
  assert.equal(stale.items[0]!.id, 'a/one');
});

test('a cold cache re-throws when the fetch fails (nothing to serve)', async () => {
  const svc = new AiModelsService({
    baseUrl: BASE,
    fetcher: async () => {
      throw new Error('openrouter down');
    },
  });
  await assert.rejects(svc.list('sk-or-A'), /openrouter down/);
});

test('capabilities() reads from cache; unknown model/key → null', async () => {
  const svc = new AiModelsService({
    baseUrl: BASE,
    fetcher: async () => [model('a/tools', { supportsTools: true }), model('b/no', { supportsTools: false })],
  });
  assert.equal(svc.capabilities('sk-or-A', 'a/tools'), null); // cold cache
  await svc.list('sk-or-A');
  assert.equal(svc.capabilities('sk-or-A', 'a/tools')!.supportsTools, true);
  assert.equal(svc.capabilities('sk-or-A', 'b/no')!.supportsTools, false);
  assert.equal(svc.capabilities('sk-or-A', 'missing/model'), null);
  assert.equal(svc.capabilities('sk-or-OTHER', 'a/tools'), null); // wrong key
});
