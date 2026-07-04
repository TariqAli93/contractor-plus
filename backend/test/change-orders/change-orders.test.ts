import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma, type PrismaClient } from '@prisma/client';
import { ChangeOrdersService } from '../../src/modules/change-orders/change-orders.service.js';

const actor = { userId: 'u1', ipAddress: '127.0.0.1', userAgent: 'test' };

interface Over {
  contract?: { id: string; status: string; totalPrice: Prisma.Decimal };
  changeOrder?: Record<string, unknown> | null;
  approvedSum?: Prisma.Decimal | null;
  count?: number;
}

// Minimal Prisma fake: $transaction runs the callback with the same op set, so
// the real repository + audit run against these stubs (no DB).
function svc(over: Over): ChangeOrdersService {
  const ops = {
    contract: { findFirst: async () => over.contract ?? null },
    changeOrder: {
      findFirst: async () => over.changeOrder ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'co-1',
        approvedAt: null,
        ...data,
      }),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
        ...(over.changeOrder ?? {}),
        id: where.id,
        ...data,
      }),
      aggregate: async () => ({ _sum: { amount: over.approvedSum ?? null } }),
      count: async () => over.count ?? 0,
    },
    auditLog: { create: async () => ({}) },
  };
  const prisma = { ...ops, $transaction: (fn: (tx: typeof ops) => unknown) => fn(ops) };
  return new ChangeOrdersService(prisma as unknown as PrismaClient);
}

test('create requires an APPROVED contract', async () => {
  const s = svc({ contract: { id: 'c1', status: 'DRAFT', totalPrice: new Prisma.Decimal(1000) } });
  await assert.rejects(
    () => s.create({ contractId: 'c1', title: 'إضافة دور', description: null, amount: 500 }, actor),
    /معتمد/,
  );
});

test('create assigns the next sequential number + keeps a signed amount', async () => {
  const s = svc({
    contract: { id: 'c1', status: 'APPROVED', totalPrice: new Prisma.Decimal(1000) },
    changeOrder: { number: 2 }, // last order → next is 3
  });
  const co = await s.create(
    { contractId: 'c1', title: 'خصم', description: null, amount: -250.5 },
    actor,
  );
  assert.equal((co as { number: number }).number, 3);
  assert.equal(Number((co as { amount: unknown }).amount), -250.5);
  assert.equal((co as { status: string }).status, 'DRAFT');
});

test('approving a non-DRAFT order is rejected', async () => {
  const s = svc({ changeOrder: { id: 'co-9', status: 'APPROVED' } });
  await assert.rejects(() => s.approve('co-9', actor), /بعد اعتماده أو رفضه/);
});

test('an approved order cannot be deleted (permanent record)', async () => {
  const s = svc({ changeOrder: { id: 'co-9', status: 'APPROVED' } });
  await assert.rejects(() => s.softDelete('co-9', actor), /بعد اعتماده أو رفضه/);
});

test('summary = original + approved delta (money serialized as strings)', async () => {
  const s = svc({
    contract: { id: 'c1', status: 'APPROVED', totalPrice: new Prisma.Decimal(1000) },
    approvedSum: new Prisma.Decimal(300),
    count: 1,
  });
  const sum = await s.summaryForContract('c1');
  assert.equal(sum.originalTotal, '1000.00');
  assert.equal(sum.approvedDelta, '300.00');
  assert.equal(sum.revisedTotal, '1300.00');
});
