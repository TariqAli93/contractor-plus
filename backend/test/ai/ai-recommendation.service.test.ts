/**
 * Phase-4 unit tests: advisory guards (never block, fail-open AI layer),
 * deterministic recommendation detectors, PENDING-suggestion lifecycle and
 * the explicit apply path through the change-orders business rules. All
 * dependencies are fakes — no DB, no network.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { AiRecommendationService } from '../../src/modules/ai-assistant/services/ai-recommendation.service.js';
import type { AiAssistantRepository } from '../../src/modules/ai-assistant/ai-assistant.repository.js';
import type { CreateAiRequestLogInput } from '../../src/modules/ai-assistant/ai-assistant.types.js';
import type { AuditActor, AuditLogInput, AuditService } from '../../src/modules/audit/audit.service.js';
import type { ReportsService } from '../../src/modules/reports/reports.service.js';
import type { CostsService } from '../../src/modules/costs/costs.service.js';
import type { PaymentsService } from '../../src/modules/payments/payments.service.js';
import type { ChangeOrdersService } from '../../src/modules/change-orders/change-orders.service.js';
import type { SettingsService } from '../../src/modules/settings/settings.service.js';
import type { AiBudgetService } from '../../src/modules/ai-assistant/services/ai-budget.service.js';
import type { AiSettingsService } from '../../src/modules/ai-assistant/services/ai-settings.service.js';
import type { ProjectProfitability } from '../../src/modules/reports/reports.types.js';
import type {
  AiCompletionInput,
  AiCompletionResult,
  AiProvider,
} from '../../src/lib/ai/ai-provider.interface.js';
import type { AiRuntime } from '../../src/lib/ai/ai-config.js';
import { ConflictError } from '../../src/shared/errors/conflict.error.js';
import { NotFoundError } from '../../src/shared/errors/not-found.error.js';

const RUNTIME_ENABLED: AiRuntime = {
  enabled: true,
  config: {
    apiKey: 'sk-or-test',
    baseUrl: 'https://openrouter.test/api/v1',
    modelDefault: 'test/default-model',
    modelHeavy: 'test/heavy-model',
    timeoutMs: 5_000,
  },
};
const RUNTIME_DISABLED: AiRuntime = { enabled: false, reason: 'NO_API_KEY' };
const ACTOR: AuditActor = { userId: 'user-1' };

const CURRENCY = {
  code: 'IQD', symbol: 'د.ع', symbolPosition: 'AFTER',
  decimalPrecision: 0, thousandSeparator: ',', decimalSeparator: '.',
};

// ---------- fakes ----------

class FakeProvider implements AiProvider {
  calls: AiCompletionInput[] = [];
  constructor(private readonly content: string, private readonly fail = false) {}
  async complete(input: AiCompletionInput): Promise<AiCompletionResult> {
    this.calls.push(input);
    if (this.fail) throw new Error('provider down');
    return {
      content: this.content,
      modelUsed: input.model,
      usage: { promptTokens: 50, completionTokens: 20 },
    };
  }
}

interface RepoRow extends CreateAiRequestLogInput { id: string; approvalState: string }

function fakeRepo() {
  const rows = new Map<string, RepoRow>();
  const created: CreateAiRequestLogInput[] = [];
  let n = 0;
  const repo = {
    createRequestLog: async (d: CreateAiRequestLogInput) => {
      const row: RepoRow = { ...d, id: `row-${++n}`, approvalState: d.approvalState ?? 'NONE' };
      rows.set(row.id, row);
      created.push(d);
      return row;
    },
    findRequestLogById: async (id: string) => rows.get(id) ?? null,
    findPendingSuggestionByRecordId: async (rid: string) =>
      [...rows.values()].find(
        (r) => r.operationType === 'RECOMMENDATION' && r.approvalState === 'PENDING' && r.recordIds.includes(rid),
      ) ?? null,
    updateApprovalState: async (id: string, state: string) => {
      const row = rows.get(id);
      if (!row) throw new Error('missing row');
      const updated = { ...row, approvalState: state };
      rows.set(id, updated);
      return updated;
    },
  } as unknown as AiAssistantRepository;
  return { repo, created, rows };
}

function fakeAudit() {
  const logged: Array<{ actor: AuditActor; input: AuditLogInput }> = [];
  const audit = {
    log: async (actor: AuditActor, input: AuditLogInput) => { logged.push({ actor, input }); },
  } as unknown as AuditService;
  return { audit, logged };
}

function profRow(overrides: Partial<ProjectProfitability> = {}): ProjectProfitability {
  return {
    projectId: 'p-1', name: 'مشروع الاختبار', contractId: 'c-1', contractNumber: 'CN-1',
    customerId: 'cu-1', customerName: 'عميل', contractValue: '1000.00', totalCosts: '500.00',
    totalPaid: '400.00', remainingBalance: '600.00', profit: '500.00', cashPosition: '-100.00',
    progressPercentage: 50, status: 'IN_PROGRESS', startDate: null, deliveryDate: null,
    ...overrides,
  };
}

interface WorldOptions {
  profitability?: ProjectProfitability[];
  single?: ProjectProfitability;
  overdue?: unknown[];
  costItems?: unknown[];
  paymentItems?: unknown[];
  provider?: AiProvider | null;
  runtime?: AiRuntime;
  overBudget?: boolean;
}

function makeWorld(opts: WorldOptions = {}) {
  const { repo, created, rows } = fakeRepo();
  const { audit, logged } = fakeAudit();
  const coCalls: unknown[] = [];

  const reports = {
    listProjectProfitability: async () => ({
      items: opts.profitability ?? [], page: 1, pageSize: 100,
      total: (opts.profitability ?? []).length, totalPages: 1,
    }),
    getProjectProfitability: async () => opts.single ?? profRow(),
    getOverduePayments: async () => opts.overdue ?? [],
  } as unknown as ReportsService;

  const costs = {
    list: async () => ({
      items: opts.costItems ?? [], page: 1, pageSize: 100,
      total: (opts.costItems ?? []).length, totalPages: 1,
    }),
  } as unknown as CostsService;

  const payments = {
    list: async () => ({
      items: opts.paymentItems ?? [], page: 1, pageSize: 100,
      total: (opts.paymentItems ?? []).length, totalPages: 1,
    }),
  } as unknown as PaymentsService;

  const changeOrders = {
    create: async (data: unknown) => {
      coCalls.push(data);
      return { id: 'co-1', number: 3, amount: '500.00' };
    },
  } as unknown as ChangeOrdersService;

  const settings = {
    getDefaultCurrency: async () => CURRENCY,
  } as unknown as SettingsService;

  // Under-budget unless a test opts into over-budget (Phase 6).
  const budget = {
    isOverBudget: async () => opts.overBudget ?? false,
    assertWithinBudget: async () => {},
    getMonthlyUsage: async () => ({}) as never,
  } as unknown as AiBudgetService;

  // Central gate fake — yields the provider only when runtime is enabled.
  const runtime = opts.runtime ?? RUNTIME_DISABLED;
  const provider = opts.provider ?? null;
  const aiSettings = {
    optionalProviderForFeature: async () =>
      runtime.enabled && provider ? { provider, config: runtime.config } : null,
    isFeatureEnabled: async () => runtime.enabled,
    resolveRuntime: async () => runtime,
  } as unknown as AiSettingsService;

  const service = new AiRecommendationService({
    aiSettings,
    repo, audit, reports, costs, payments, changeOrders, settings, budget,
  });
  return { service, created, rows, logged, coCalls };
}

const COST_INPUT = {
  projectId: 'p-1', category: 'MATERIAL' as const, materialId: null,
  description: 'أسمنت مقاوم', quantity: null, unit: null, unitPrice: null,
  totalAmount: 200, date: new Date('2026-07-10'), notes: null,
};

const PAYMENT_INPUT = {
  projectId: 'p-1', amount: 700, dueDate: new Date('2026-07-20'),
  method: null, reference: null, notes: null,
};

// ============================================================
// Save-guards
// ============================================================

test('guardCost: exceeding the contract value warns but NEVER blocks (returns, no throw)', async () => {
  const { service } = makeWorld({
    single: profRow({ contractValue: '1000.00', totalCosts: '900.00' }),
  });
  const result = await service.guardCost(COST_INPUT, ACTOR);
  const codes = result.warnings.map((w) => w.code);
  assert.ok(codes.includes('COSTS_EXCEED_CONTRACT'));
  assert.equal(result.aiChecked, false); // AI disabled → rules still ran
  assert.ok(result.warnings.every((w) => w.source === 'rule'));
});

test('guardCost: same-amount cost in the window → POSSIBLE_DUPLICATE_COST', async () => {
  const { service } = makeWorld({
    single: profRow(),
    costItems: [{ totalAmount: '200.00', date: new Date('2026-07-08') }],
  });
  const result = await service.guardCost(COST_INPUT, ACTOR);
  assert.ok(result.warnings.some((w) => w.code === 'POSSIBLE_DUPLICATE_COST'));
});

test('guardCost: AI layer merges model warnings and is governed (SAVE_GUARD row)', async () => {
  const provider = new FakeProvider(
    JSON.stringify({ warnings: [{ code: 'ODD_CATEGORY', severity: 'info', message: 'الوصف يوحي بمواد لكن الفئة نقل.' }] }),
  );
  const { service, created } = makeWorld({ single: profRow(), provider, runtime: RUNTIME_ENABLED });
  const result = await service.guardCost(COST_INPUT, ACTOR);
  assert.equal(result.aiChecked, true);
  const ai = result.warnings.find((w) => w.source === 'ai');
  assert.equal(ai?.code, 'ODD_CATEGORY');
  assert.equal(created.length, 1);
  assert.equal(created[0]!.operationType, 'SAVE_GUARD');
});

test('guardCost: over monthly budget → AI layer skipped, rules still answer (Phase 6)', async () => {
  const provider = new FakeProvider(
    JSON.stringify({ warnings: [{ code: 'X', severity: 'info', message: 'y' }] }),
  );
  const { service } = makeWorld({
    single: profRow({ contractValue: '1000.00', totalCosts: '900.00' }),
    provider, runtime: RUNTIME_ENABLED, overBudget: true,
  });
  const result = await service.guardCost(COST_INPUT, ACTOR);
  assert.ok(result.warnings.some((w) => w.code === 'COSTS_EXCEED_CONTRACT'));
  assert.equal(result.aiChecked, false); // budget stopped the model layer
  assert.equal(provider.calls.length, 0);
});

test('guardCost: provider failure fails OPEN — rules answer, aiChecked=false, no throw', async () => {
  const provider = new FakeProvider('', true);
  const { service } = makeWorld({
    single: profRow({ contractValue: '1000.00', totalCosts: '900.00' }),
    provider, runtime: RUNTIME_ENABLED,
  });
  const result = await service.guardCost(COST_INPUT, ACTOR);
  assert.ok(result.warnings.some((w) => w.code === 'COSTS_EXCEED_CONTRACT'));
  assert.equal(result.aiChecked, false);
});

test('guardCost: bad AI output is dropped (aiChecked=false) and logged as rejected', async () => {
  const provider = new FakeProvider('هذا ليس JSON');
  const { service, created } = makeWorld({ single: profRow(), provider, runtime: RUNTIME_ENABLED });
  const result = await service.guardCost(COST_INPUT, ACTOR);
  assert.equal(result.aiChecked, false);
  assert.equal(created.length, 1);
  assert.match(created[0]!.outputSummary, /rejected/);
});

test('guardPayment: exceeding remaining balance + duplicate amount both warn', async () => {
  const { service } = makeWorld({
    single: profRow({ remainingBalance: '600.00' }),
    paymentItems: [
      { amount: '700.00', dueDate: new Date('2026-07-18'), status: 'PENDING', reference: null },
    ],
  });
  const result = await service.guardPayment(PAYMENT_INPUT, ACTOR);
  const codes = result.warnings.map((w) => w.code);
  assert.ok(codes.includes('EXCEEDS_REMAINING_BALANCE'));
  assert.ok(codes.includes('POSSIBLE_DUPLICATE_PAYMENT'));
});

test('guardPayment: duplicate reference detected', async () => {
  const { service } = makeWorld({
    single: profRow({ remainingBalance: '10000.00' }),
    paymentItems: [
      { amount: '50.00', dueDate: new Date('2026-07-01'), status: 'PAID', reference: 'INV-77' },
    ],
  });
  const result = await service.guardPayment({ ...PAYMENT_INPUT, amount: 100, reference: 'INV-77' }, ACTOR);
  assert.ok(result.warnings.some((w) => w.code === 'DUPLICATE_REFERENCE'));
});

// ============================================================
// Recommendations — detectors, suggestions, enrichment
// ============================================================

const NEGATIVE_ROW = profRow({
  projectId: 'p-neg', name: 'مشروع خاسر', contractId: 'c-neg', contractNumber: 'CN-9',
  contractValue: '1000.00', totalCosts: '1500.00', profit: '-500.00', progressPercentage: 70,
});

test('detectors: negative margin becomes a critical APPLICABLE finding with a PENDING suggestion (offline too)', async () => {
  const { service, created, logged } = makeWorld({ profitability: [NEGATIVE_ROW] });
  const result = await service.listRecommendations(ACTOR);

  const finding = result.items.find((i) => i.kind === 'NEGATIVE_MARGIN');
  assert.ok(finding);
  assert.equal(finding!.severity, 'critical');
  assert.equal(finding!.applicable, true);
  assert.ok(finding!.suggestionId);
  assert.equal(result.aiEnriched, false); // AI disabled — everything still works

  // The suggestion row: PENDING + audited with approvalState (acceptance).
  const suggestion = created.find((c) => c.approvalState === 'PENDING');
  assert.ok(suggestion);
  assert.equal(suggestion!.operationType, 'RECOMMENDATION');
  assert.deepEqual(suggestion!.recordIds, ['c-neg', 'p-neg']);
  const auditEntry = logged.find(
    (l) => (l.input.newValues as { approvalState?: string }).approvalState === 'PENDING',
  );
  assert.ok(auditEntry);
});

test('detectors: low margin + spend-without-progress + repeat late customer + material rise', async () => {
  const now = new Date();
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 3600 * 1000);
  const { service } = makeWorld({
    profitability: [
      profRow({ contractId: 'c-low', projectId: 'p-low', profit: '50.00', contractValue: '1000.00' }),
      profRow({
        contractId: 'c-sp', projectId: 'p-sp', profit: '300.00',
        totalCosts: '700.00', contractValue: '1000.00', progressPercentage: 20,
      }),
    ],
    overdue: [
      { projectId: 'p-a', customerId: 'cu-9', customerName: 'شركة الوفاء', overduePaymentsCount: 2, totalOverdueAmount: '100.00' },
      { projectId: 'p-b', customerId: 'cu-9', customerName: 'شركة الوفاء', overduePaymentsCount: 1, totalOverdueAmount: '50.00' },
    ],
    costItems: [
      { materialId: 'm-1', material: { id: 'm-1', name: 'حديد تسليح', unit: 'طن' }, unitPrice: '120.00', date: daysAgo(3) },
      { materialId: 'm-1', material: { id: 'm-1', name: 'حديد تسليح', unit: 'طن' }, unitPrice: '124.00', date: daysAgo(10) },
      { materialId: 'm-1', material: { id: 'm-1', name: 'حديد تسليح', unit: 'طن' }, unitPrice: '100.00', date: daysAgo(60) },
      { materialId: 'm-1', material: { id: 'm-1', name: 'حديد تسليح', unit: 'طن' }, unitPrice: '102.00', date: daysAgo(90) },
    ],
  });
  const result = await service.listRecommendations(ACTOR);
  const kinds = result.items.map((i) => i.kind);
  assert.ok(kinds.includes('LOW_MARGIN'));
  assert.ok(kinds.includes('SPEND_WITHOUT_PROGRESS'));
  assert.ok(kinds.includes('REPEAT_LATE_CUSTOMER'));
  assert.ok(kinds.includes('MATERIAL_PRICE_RISE'));
  // None of these are applicable — no suggestion rows for them.
  assert.ok(result.items.every((i) => i.kind === 'NEGATIVE_MARGIN' || !i.applicable));
});

test('suggestions dedupe: refreshing recommendations reuses the PENDING row', async () => {
  const world = makeWorld({ profitability: [NEGATIVE_ROW] });
  const first = await world.service.listRecommendations(ACTOR);
  const second = await world.service.listRecommendations(ACTOR);
  const id1 = first.items.find((i) => i.applicable)!.suggestionId;
  const id2 = second.items.find((i) => i.applicable)!.suggestionId;
  assert.equal(id1, id2);
  assert.equal(world.created.filter((c) => c.approvalState === 'PENDING').length, 1);
});

test('enrichment: model priorities join by id, invented ids are ignored, heavy model at threshold', async () => {
  const provider = new FakeProvider(
    JSON.stringify({
      items: [
        { id: 'NEGATIVE_MARGIN:c-neg', priority: 5, advice: 'راجع تسعير العقد فورًا.' },
        { id: 'HALLUCINATED:x', priority: 4, advice: 'بند مخترع.' },
      ],
    }),
  );
  // 5 findings → the internal heavy-model switch flips.
  const now = new Date();
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 3600 * 1000);
  const { service } = makeWorld({
    provider, runtime: RUNTIME_ENABLED,
    profitability: [
      NEGATIVE_ROW,
      profRow({ contractId: 'c-low', projectId: 'p-low', profit: '50.00' }),
      profRow({ contractId: 'c-sp', projectId: 'p-sp', profit: '300.00', totalCosts: '700.00', progressPercentage: 20 }),
    ],
    overdue: [
      { projectId: 'p-a', customerId: 'cu-9', customerName: 'عميل', overduePaymentsCount: 3, totalOverdueAmount: '100.00' },
    ],
    costItems: [
      { materialId: 'm-1', material: { id: 'm-1', name: 'حديد', unit: 'طن' }, unitPrice: '120.00', date: daysAgo(3) },
      { materialId: 'm-1', material: { id: 'm-1', name: 'حديد', unit: 'طن' }, unitPrice: '124.00', date: daysAgo(10) },
      { materialId: 'm-1', material: { id: 'm-1', name: 'حديد', unit: 'طن' }, unitPrice: '100.00', date: daysAgo(60) },
      { materialId: 'm-1', material: { id: 'm-1', name: 'حديد', unit: 'طن' }, unitPrice: '101.00', date: daysAgo(80) },
    ],
  });
  const result = await service.listRecommendations(ACTOR);
  assert.equal(result.aiEnriched, true);
  assert.equal(result.modelUsed, 'test/heavy-model');
  const negative = result.items.find((i) => i.kind === 'NEGATIVE_MARGIN')!;
  assert.equal(negative.aiPriority, 5);
  assert.match(negative.aiAdvice!, /راجع تسعير/);
  assert.ok(result.items.every((i) => i.aiAdvice !== 'بند مخترع.'));
});

// ============================================================
// Apply / Reject — the explicit approval state machine
// ============================================================

async function seedPendingSuggestion(world: ReturnType<typeof makeWorld>) {
  await world.service.listRecommendations(ACTOR);
  const pending = [...world.rows.values()].find((r) => r.approvalState === 'PENDING');
  assert.ok(pending, 'expected a pending suggestion after listRecommendations');
  return pending!;
}

test('apply: PENDING → APPROVED creates a DRAFT change order through the CO service', async () => {
  const world = makeWorld({ profitability: [NEGATIVE_ROW], single: NEGATIVE_ROW });
  const pending = await seedPendingSuggestion(world);

  const result = await world.service.applySuggestion(pending.id, ACTOR);

  assert.equal(result.approvalState, 'APPROVED');
  assert.equal(result.changeOrder.id, 'co-1');
  // The CO got the RECOMPUTED deficit as a positive signed delta.
  assert.equal(world.coCalls.length, 1);
  const coInput = world.coCalls[0] as { contractId: string; amount: number };
  assert.equal(coInput.contractId, 'c-neg');
  assert.equal(coInput.amount, 500);
  // Audit UPDATE with the state transition.
  const auditUpdate = world.logged.find((l) => l.input.action === 'UPDATE');
  assert.ok(auditUpdate);
  assert.equal(
    (auditUpdate!.input.newValues as { approvalState: string }).approvalState,
    'APPROVED',
  );
});

test('apply: stale suggestion (margin recovered) → 409 SUGGESTION_STALE, stays PENDING', async () => {
  const world = makeWorld({
    profitability: [NEGATIVE_ROW],
    single: profRow({ profit: '250.00' }), // recomputed: margin is healthy now
  });
  const pending = await seedPendingSuggestion(world);

  await assert.rejects(
    world.service.applySuggestion(pending.id, ACTOR),
    (err: unknown) => err instanceof ConflictError && err.code === 'SUGGESTION_STALE',
  );
  assert.equal(world.rows.get(pending.id)!.approvalState, 'PENDING');
  assert.equal(world.coCalls.length, 0);
});

test('apply: unknown id → SUGGESTION_NOT_FOUND; non-pending → SUGGESTION_NOT_PENDING', async () => {
  const world = makeWorld({ profitability: [NEGATIVE_ROW], single: NEGATIVE_ROW });
  const pending = await seedPendingSuggestion(world);

  await assert.rejects(
    world.service.applySuggestion('missing-id', ACTOR),
    (err: unknown) => err instanceof NotFoundError,
  );

  await world.service.applySuggestion(pending.id, ACTOR);
  await assert.rejects(
    world.service.applySuggestion(pending.id, ACTOR),
    (err: unknown) => err instanceof ConflictError && err.code === 'SUGGESTION_NOT_PENDING',
  );
});

test('reject: PENDING → REJECTED with audit, no change order involved', async () => {
  const world = makeWorld({ profitability: [NEGATIVE_ROW], single: NEGATIVE_ROW });
  const pending = await seedPendingSuggestion(world);

  const result = await world.service.rejectSuggestion(pending.id, ACTOR);
  assert.equal(result.approvalState, 'REJECTED');
  assert.equal(world.coCalls.length, 0);
  const auditUpdate = world.logged.find(
    (l) => l.input.action === 'UPDATE' &&
      (l.input.newValues as { approvalState?: string }).approvalState === 'REJECTED',
  );
  assert.ok(auditUpdate);
});
