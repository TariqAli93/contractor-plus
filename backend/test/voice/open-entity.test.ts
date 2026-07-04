import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OpenEntityHandler } from '../../src/modules/voice/engine/intents/open-entity.handler.js';
import type { EntityBag } from '@contractor-plus/shared';
import type { SessionContext } from '../../src/modules/voice/engine/voice.types.js';

const actor = { userId: 'u1', role: 'OWNER', ipAddress: '127.0.0.1', userAgent: 'test' };

// Minimal fake repos — only the methods the handler calls.
function makeHandler(over: {
  project?: { id: string; name: string } | null;
  contract?: { id: string; contractNumber: string } | null;
  customers?: Array<{ id: string; name: string }>;
}) {
  return new OpenEntityHandler({
    projects: {
      findFirstByName: async () => over.project ?? null,
    },
    customers: {
      findByName: async () => over.customers ?? [],
    },
    contractsRepo: {
      findByContractNumber: async () => over.contract ?? null,
    },
  } as unknown as ConstructorParameters<typeof OpenEntityHandler>[0]);
}

function run(
  h: OpenEntityHandler,
  transcript: string,
  bag: EntityBag = {},
  context: SessionContext = {},
) {
  return h.plan({ intent: 'open_entity', bag, context, actor, transcript });
}

test('open contract by number → navigate to its detail (no confirmation)', async () => {
  const h = makeHandler({ contract: { id: 'c1', contractNumber: 'V-2026-0004' } });
  const plan = await run(h, 'افتح العقد رقم V-2026-0004', { contractRef: 'V-2026-0004' });
  assert.equal(plan.side, 'client');
  assert.equal(plan.mutates, false);
  assert.deepEqual(plan.clientActions, [{ type: 'navigate', to: '/contracts/c1' }]);
});

test('open project by name → navigate', async () => {
  const h = makeHandler({ project: { id: 'p1', name: 'فيلا أحمد' } });
  const plan = await run(h, 'افتح مشروع فيلا أحمد');
  assert.deepEqual(plan.clientActions, [{ type: 'navigate', to: '/projects/p1' }]);
});

test('open last project via session context', async () => {
  const h = makeHandler({});
  const plan = await run(h, 'افتح آخر مشروع', { entityRef: 'اخر' }, { lastProjectId: 'p9' });
  assert.deepEqual(plan.clientActions, [{ type: 'navigate', to: '/projects/p9' }]);
});

test('open customer by name → navigate', async () => {
  const h = makeHandler({ customers: [{ id: 'cu1', name: 'أحمد علي' }] });
  const plan = await run(h, 'افتح العميل أحمد علي', { customerName: 'أحمد علي' });
  assert.deepEqual(plan.clientActions, [{ type: 'navigate', to: '/customers/cu1' }]);
});

test('not found → navigate to the list + an info toast (never a dead end)', async () => {
  const h = makeHandler({ project: null });
  const plan = await run(h, 'افتح مشروع غير موجود ابداً');
  assert.equal(plan.clientActions?.[0]?.type, 'navigate');
  assert.equal((plan.clientActions?.[0] as { to: string }).to, '/projects');
  assert.equal(plan.clientActions?.[1]?.type, 'toast');
});

test('no recognizable target → clarify', async () => {
  const h = makeHandler({});
  await assert.rejects(() => run(h, 'افتح'), /ماذا تريد أن تفتح/);
});
