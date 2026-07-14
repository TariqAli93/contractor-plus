/**
 * Phase-5 unit tests: the material-price sync (fetch → validate → match →
 * append), its offline resilience, the audit summary, and the same-currency
 * price-change detection. All dependencies are fakes — no DB, no real network.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { AiMaterialPricesService } from '../../src/modules/ai-assistant/services/ai-material-prices.service.js';
import { MaterialPriceSourceClient } from '../../src/lib/ai/material-price-source.js';
import type { MaterialPriceSource } from '../../src/config/app-config.js';
import type {
  AiAssistantRepository,
  ReferencePriceWithMaterial,
} from '../../src/modules/ai-assistant/ai-assistant.repository.js';
import type { InsertReferencePriceInput } from '../../src/modules/ai-assistant/ai-assistant.types.js';
import type { AuditActor, AuditLogInput, AuditService } from '../../src/modules/audit/audit.service.js';
import type { MaterialsService } from '../../src/modules/materials/materials.service.js';

const ACTOR: AuditActor = { userId: 'user-1' };
const SYSTEM_ACTOR: AuditActor = { userId: null };

// ---------- fakes ----------

/** A fake fetch resolving a canned JSON (or error) per URL. */
function fakeFetch(routes: Record<string, { status?: number; body?: unknown; throw?: boolean }>) {
  return (async (url: unknown) => {
    const route = routes[String(url)];
    if (!route || route.throw) throw new TypeError('fetch failed');
    return new Response(JSON.stringify(route.body ?? {}), {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

function fakeRepo(recent: ReferencePriceWithMaterial[] = []) {
  const inserted: InsertReferencePriceInput[] = [];
  const repo = {
    insertReferencePrice: async (data: InsertReferencePriceInput) => {
      inserted.push(data);
      return { id: `rp-${inserted.length}`, ...data } as unknown;
    },
    findRecentReferencePrices: async () => recent,
    findLatestReferencePrice: async () => recent[0] ?? null,
  } as unknown as AiAssistantRepository;
  return { repo, inserted };
}

function fakeMaterials(names: Array<{ id: string; name: string; unit?: string }>) {
  return {
    list: async () => ({
      items: names.map((n) => ({ id: n.id, name: n.name, unit: n.unit ?? 'وحدة' })),
      page: 1,
      pageSize: 1000,
      total: names.length,
      totalPages: 1,
    }),
  } as unknown as MaterialsService;
}

function fakeAudit() {
  const logged: Array<{ actor: AuditActor; input: AuditLogInput }> = [];
  const audit = {
    log: async (actor: AuditActor, input: AuditLogInput) => { logged.push({ actor, input }); },
  } as unknown as AuditService;
  return { audit, logged };
}

const SOURCE: MaterialPriceSource = {
  name: 'مصدر تجريبي',
  url: 'http://prices.test/a.json',
  region: 'IQ',
};

function makeService(opts: {
  sources?: MaterialPriceSource[];
  routes?: Parameters<typeof fakeFetch>[0];
  materials?: Array<{ id: string; name: string; unit?: string }>;
  recent?: ReferencePriceWithMaterial[];
}) {
  const { repo, inserted } = fakeRepo(opts.recent);
  const { audit, logged } = fakeAudit();
  const sourceClient = new MaterialPriceSourceClient({
    fetchImpl: fakeFetch(opts.routes ?? {}),
  });
  const sources = opts.sources ?? [];
  const service = new AiMaterialPricesService({
    repo,
    materials: fakeMaterials(opts.materials ?? []),
    audit,
    resolveSources: async () => sources,
    sourceClient,
  });
  return { service, inserted, logged };
}

// ---------- sync ----------

test('no sources configured → safe no-op, still audited', async () => {
  const { service, inserted, logged } = makeService({ sources: [] });
  const result = await service.syncPrices(ACTOR);
  assert.equal(result.enabled, false);
  assert.equal(result.sources, 0);
  assert.equal(inserted.length, 0);
  assert.equal(logged.length, 1); // sync summary still written
  assert.equal(logged[0]!.input.entity, 'MaterialPriceSync');
});

test('matched rows append a reference price; original currency preserved', async () => {
  const { service, inserted, logged } = makeService({
    sources: [SOURCE],
    materials: [{ id: 'm-cement', name: 'أسمنت' }, { id: 'm-steel', name: 'حديد تسليح' }],
    routes: {
      'http://prices.test/a.json': {
        body: {
          prices: [
            { material: 'أسمنت', price: 8500, currency: 'IQD', updatedAt: '2026-07-01' },
            { material: 'حديد تسليح', price: 1250000, currency: 'IQD' },
          ],
        },
      },
    },
  });
  const result = await service.syncPrices(ACTOR);
  assert.equal(result.fetched, 2);
  assert.equal(result.matched, 2);
  assert.equal(result.inserted, 2);
  assert.equal(result.skippedUnmatched, 0);
  assert.equal(inserted.length, 2);

  const cement = inserted.find((r) => r.materialId === 'm-cement')!;
  assert.equal(cement.referencePrice, '8500.00');
  assert.equal(cement.referenceCurrency, 'IQD'); // not converted
  assert.equal(cement.referenceSource, 'مصدر تجريبي');
  assert.equal(cement.referenceRegion, 'IQ');
  assert.equal(cement.referenceUpdatedAt.toISOString().slice(0, 10), '2026-07-01');

  // Missing updatedAt falls back to the run time (a valid recent date).
  const steel = inserted.find((r) => r.materialId === 'm-steel')!;
  assert.ok(steel.referenceUpdatedAt instanceof Date);

  const summary = logged[0]!.input.newValues as { inserted: number };
  assert.equal(summary.inserted, 2);
});

test('unmatched material names are skipped, not invented', async () => {
  const { service, inserted } = makeService({
    sources: [SOURCE],
    materials: [{ id: 'm-cement', name: 'أسمنت' }],
    routes: {
      'http://prices.test/a.json': {
        body: {
          prices: [
            { material: 'أسمنت', price: 8500, currency: 'IQD' },
            { material: 'مادة غير معروفة', price: 999, currency: 'IQD' },
          ],
        },
      },
    },
  });
  const result = await service.syncPrices(ACTOR);
  assert.equal(result.fetched, 2);
  assert.equal(result.matched, 1);
  assert.equal(result.skippedUnmatched, 1);
  assert.equal(inserted.length, 1);
});

test('name matching is case/whitespace-insensitive', async () => {
  const { service, inserted } = makeService({
    sources: [SOURCE],
    materials: [{ id: 'm-x', name: 'Portland Cement' }],
    routes: {
      'http://prices.test/a.json': {
        body: { prices: [{ material: '  portland   cement ', price: 10, currency: 'USD' }] },
      },
    },
  });
  await service.syncPrices(ACTOR);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0]!.materialId, 'm-x');
});

test('a dead source is collected as an error and does NOT abort the run (offline resilience)', async () => {
  const dead: MaterialPriceSource = { name: 'مصدر معطّل', url: 'http://down.test/x.json' };
  const { service, inserted, logged } = makeService({
    sources: [dead, SOURCE],
    materials: [{ id: 'm-cement', name: 'أسمنت' }],
    routes: {
      'http://down.test/x.json': { throw: true },
      'http://prices.test/a.json': {
        body: { prices: [{ material: 'أسمنت', price: 8500, currency: 'IQD' }] },
      },
    },
  });
  const result = await service.syncPrices(ACTOR);
  // The healthy source still produced a row.
  assert.equal(result.inserted, 1);
  assert.equal(inserted.length, 1);
  // The dead source is recorded by NAME + reason only (no content).
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0]!.source, 'مصدر معطّل');
  const summary = logged[0]!.input.newValues as { errorCount: number };
  assert.equal(summary.errorCount, 1);
});

test('a malformed source document is rejected wholesale (bad schema → error, no rows)', async () => {
  const { service, inserted, logged } = makeService({
    sources: [SOURCE],
    materials: [{ id: 'm-cement', name: 'أسمنت' }],
    routes: {
      'http://prices.test/a.json': { body: { prices: [{ material: 'أسمنت', price: 'not-a-number', currency: 'IQD' }] } },
    },
  });
  const result = await service.syncPrices(ACTOR);
  assert.equal(result.inserted, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0]!.message, /schema/);
  assert.equal(inserted.length, 0);
  void logged;
});

test('HTTP 500 from a source is an error, not a throw', async () => {
  const { service, inserted } = makeService({
    sources: [SOURCE],
    materials: [{ id: 'm-cement', name: 'أسمنت' }],
    routes: { 'http://prices.test/a.json': { status: 500 } },
  });
  const result = await service.syncPrices(ACTOR);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0]!.message, /HTTP 500/);
  assert.equal(inserted.length, 0);
});

test('the scheduled path attributes the sync to a system actor (null user)', async () => {
  const { service, logged } = makeService({ sources: [] });
  await service.syncPrices(SYSTEM_ACTOR);
  assert.equal(logged[0]!.actor.userId, null);
});

// ---------- price-change detection ----------

function priceRow(
  materialId: string,
  price: string,
  currency: string,
  daysAgo: number,
  name = 'مادة',
): ReferencePriceWithMaterial {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return {
    id: `${materialId}-${daysAgo}`,
    materialId,
    referencePrice: price as unknown as ReferencePriceWithMaterial['referencePrice'],
    referenceCurrency: currency,
    referenceSource: 'مصدر',
    referenceRegion: 'IQ',
    referenceUpdatedAt: d,
    createdAt: d,
    material: { id: materialId, name, unit: 'طن' },
  } as ReferencePriceWithMaterial;
}

test('price change = latest vs prior of the SAME material, signed percent + direction', async () => {
  // Repo returns rows already ordered (materialId asc, referenceUpdatedAt desc).
  const { service } = makeService({
    sources: [],
    recent: [
      priceRow('m-1', '110.00', 'IQD', 2, 'حديد'),
      priceRow('m-1', '100.00', 'IQD', 40, 'حديد'),
    ],
  });
  const changes = await service.getRecentPriceChanges();
  assert.equal(changes.length, 1);
  assert.equal(changes[0]!.materialId, 'm-1');
  assert.equal(changes[0]!.direction, 'up');
  assert.equal(changes[0]!.changePercent, 10);
  assert.equal(changes[0]!.currentPrice, '110.00');
  assert.equal(changes[0]!.previousPrice, '100.00');
});

test('a currency change between the two latest rows is NOT reported as a delta (rule #5)', async () => {
  const { service } = makeService({
    sources: [],
    recent: [
      priceRow('m-1', '5.00', 'USD', 2),
      priceRow('m-1', '6000.00', 'IQD', 40),
    ],
  });
  const changes = await service.getRecentPriceChanges();
  assert.equal(changes.length, 0);
});

test('a single reference row (no prior) yields no change', async () => {
  const { service } = makeService({ sources: [], recent: [priceRow('m-1', '100.00', 'IQD', 2)] });
  assert.deepEqual(await service.getRecentPriceChanges(), []);
});

test('changes are sorted by magnitude across materials', async () => {
  const { service } = makeService({
    sources: [],
    recent: [
      priceRow('m-1', '105.00', 'IQD', 1, 'مادة أ'), // +5%
      priceRow('m-1', '100.00', 'IQD', 30, 'مادة أ'),
      priceRow('m-2', '70.00', 'IQD', 1, 'مادة ب'), // -30%
      priceRow('m-2', '100.00', 'IQD', 30, 'مادة ب'),
    ],
  });
  const changes = await service.getRecentPriceChanges();
  assert.equal(changes.length, 2);
  assert.equal(changes[0]!.materialId, 'm-2'); // 30% magnitude first
  assert.equal(changes[0]!.direction, 'down');
  assert.equal(changes[1]!.materialId, 'm-1');
});

test('getLatestForMaterial maps to a display DTO', async () => {
  const { service } = makeService({ sources: [], recent: [priceRow('m-1', '8500.00', 'IQD', 3, 'أسمنت')] });
  const dto = await service.getLatestForMaterial('m-1');
  assert.ok(dto);
  assert.equal(dto!.price, '8500.00');
  assert.equal(dto!.currency, 'IQD');
  assert.equal(dto!.source, 'مصدر');
});
