/**
 * Unit tests for the Phase-2 narrative flow: AiReportService (provider call,
 * output contract, governance logging, disabled mode) and AiContextService
 * (sensitive-field stripping, money formatting, row capping). All
 * dependencies are fakes — no DB, no network, no env.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { AiReportService } from '../../src/modules/ai-assistant/services/ai-report.service.js';
import { AiContextService } from '../../src/modules/ai-assistant/services/ai-context.service.js';
import { AiValidationService } from '../../src/modules/ai-assistant/services/ai-validation.service.js';
import type { AiAssistantRepository } from '../../src/modules/ai-assistant/ai-assistant.repository.js';
import type { CreateAiRequestLogInput } from '../../src/modules/ai-assistant/ai-assistant.types.js';
import type { AuditActor, AuditLogInput, AuditService } from '../../src/modules/audit/audit.service.js';
import type { ReportsService } from '../../src/modules/reports/reports.service.js';
import type { SettingsService } from '../../src/modules/settings/settings.service.js';
import type {
  AiCompletionInput,
  AiCompletionResult,
  AiProvider,
} from '../../src/lib/ai/ai-provider.interface.js';
import type { AiRuntime } from '../../src/lib/ai/ai-config.js';
import { AppError } from '../../src/shared/errors/app-error.js';
import { UpstreamError } from '../../src/shared/errors/upstream.error.js';

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

const ACTOR: AuditActor = { userId: 'user-1', ipAddress: '127.0.0.1' };

const GOOD_OUTPUT = JSON.stringify({
  narrative: 'صافي التدفق النقدي موجب بواقع 15,000 د.ع خلال الفترة.',
  factors: ['تحصيل 80% من الإيراد', 'مصاريف مستقرة'],
});

// ---------- fakes ----------

class FakeProvider implements AiProvider {
  calls: AiCompletionInput[] = [];
  private readonly contents: string[];
  constructor(
    content: string | string[],
    private readonly usage = { promptTokens: 100, completionTokens: 50 },
  ) {
    this.contents = Array.isArray(content) ? content : [content];
  }
  async complete(input: AiCompletionInput): Promise<AiCompletionResult> {
    this.calls.push(input);
    const content = this.contents[Math.min(this.calls.length - 1, this.contents.length - 1)]!;
    return { content, modelUsed: input.model, usage: this.usage };
  }
}

function fakeReportsService() {
  const calls: Array<{ method: string; args: unknown }> = [];
  const reports = {
    getCashFlow: async (args: unknown) => {
      calls.push({ method: 'getCashFlow', args });
      return { totalRevenue: '15000.00', netCashFlow: '3000.00' };
    },
    getDelayedProjects: async (args: unknown) => {
      calls.push({ method: 'getDelayedProjects', args });
      return [];
    },
    getOverduePayments: async (args: unknown) => {
      calls.push({ method: 'getOverduePayments', args });
      return [];
    },
    listProjectProfitability: async (args: unknown) => {
      calls.push({ method: 'listProjectProfitability', args });
      return { items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 };
    },
  } as unknown as ReportsService;
  return { reports, calls };
}

function fakeRepo() {
  const created: CreateAiRequestLogInput[] = [];
  const repo = {
    createRequestLog: async (data: CreateAiRequestLogInput) => {
      created.push(data);
      return { id: 'log-1' };
    },
  } as unknown as AiAssistantRepository;
  return { repo, created };
}

function fakeAudit() {
  const logged: Array<{ actor: AuditActor; input: AuditLogInput }> = [];
  const audit = {
    log: async (actor: AuditActor, input: AuditLogInput) => {
      logged.push({ actor, input });
    },
  } as unknown as AuditService;
  return { audit, logged };
}

const CURRENCY = {
  code: 'IQD',
  symbol: 'د.ع',
  symbolPosition: 'AFTER',
  decimalPrecision: 0,
  thousandSeparator: ',',
  decimalSeparator: '.',
};

function fakeContextDeps(overrides: Partial<Record<keyof ReportsService, unknown>> = {}) {
  const reports = {
    getCashFlow: async () => ({
      dateFrom: '2026-06-01',
      dateTo: '2026-06-30',
      totalRevenue: '15000.00',
      totalCollected: '12000.00',
      outstandingBalance: '3000.00',
      totalCosts: '9000.00',
      netCashFlow: '3000.00',
    }),
    ...overrides,
  } as unknown as ReportsService;
  const settings = {
    getDefaultCurrency: async () => CURRENCY,
  } as unknown as SettingsService;
  return new AiContextService(reports, settings);
}

function makeService(opts: {
  provider?: AiProvider | null;
  runtime?: AiRuntime;
  context?: AiContextService;
}) {
  const { repo, created } = fakeRepo();
  const { audit, logged } = fakeAudit();
  const { reports, calls: reportsCalls } = fakeReportsService();
  const service = new AiReportService({
    runtime: opts.runtime ?? RUNTIME_ENABLED,
    provider: opts.provider ?? new FakeProvider(GOOD_OUTPUT),
    context: opts.context ?? fakeContextDeps(),
    repo,
    audit,
    reports,
    validation: new AiValidationService(),
  });
  return { service, created, logged, reportsCalls };
}

// ---------- AiReportService ----------

test('narrative happy path: json_object request, parsed output, governance rows', async () => {
  const provider = new FakeProvider(GOOD_OUTPUT);
  const { service, created, logged } = makeService({ provider });

  const result = await service.narrative('cash-flow', {}, ACTOR);

  // Provider was asked for the DEFAULT model with strict JSON output.
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0]!.model, 'test/default-model');
  assert.equal(provider.calls[0]!.responseFormat, 'json_object');

  assert.match(result.narrative, /صافي التدفق/);
  assert.deepEqual(result.factors, ['تحصيل 80% من الإيراد', 'مصاريف مستقرة']);
  assert.equal(result.modelUsed, 'test/default-model');

  // AiRequestLog summary with model + usage (the governance acceptance).
  assert.equal(created.length, 1);
  const log = created[0]!;
  assert.equal(log.operationType, 'REPORT_NARRATIVE');
  assert.equal(log.modelUsed, 'test/default-model');
  assert.equal(log.tokensPrompt, 100);
  assert.equal(log.tokensCompletion, 50);
  assert.deepEqual(log.sourceModules, ['reports']);
  assert.ok(log.outputSummary.length <= 160);

  // Audit entry references the created row, summary only.
  assert.equal(logged.length, 1);
  assert.equal(logged[0]!.input.entity, 'AiRequestLog');
  assert.equal(logged[0]!.input.entityId, 'log-1');
});

test('factors default to [] when the model omits them', async () => {
  const provider = new FakeProvider(JSON.stringify({ narrative: 'نص فقط.' }));
  const { service } = makeService({ provider });
  const result = await service.narrative('cash-flow', {}, ACTOR);
  assert.deepEqual(result.factors, []);
});

test('markdown-fenced JSON is tolerated (real OpenRouter behavior)', async () => {
  const provider = new FakeProvider('```json\n' + GOOD_OUTPUT + '\n```');
  const { service, created } = makeService({ provider });
  const result = await service.narrative('cash-flow', {}, ACTOR);
  assert.match(result.narrative, /صافي التدفق/);
  assert.equal(created.length, 1);
});

test('JSON preceded by chatter is tolerated, still schema-gated', async () => {
  const provider = new FakeProvider(`إليك التفسير المطلوب:\n${GOOD_OUTPUT}\nآمل أن يفيد.`);
  const { service } = makeService({ provider });
  const result = await service.narrative('cash-flow', {}, ACTOR);
  assert.deepEqual(result.factors, ['تحصيل 80% من الإيراد', 'مصاريف مستقرة']);
});

test('non-JSON model output → AI_PROVIDER_BAD_RESPONSE, call still governed (rule #4)', async () => {
  const provider = new FakeProvider('التقرير يبدو جيدًا بشكل عام.');
  const { service, created, logged } = makeService({ provider });
  await assert.rejects(
    service.narrative('cash-flow', {}, ACTOR),
    (err: unknown) => err instanceof UpstreamError && err.code === 'AI_PROVIDER_BAD_RESPONSE',
  );
  // Tokens were spent — the rejected call is still recorded, summary-only.
  assert.equal(created.length, 1);
  assert.match(created[0]!.outputSummary, /rejected/);
  assert.equal(logged.length, 1);
});

test('schema-violating JSON (wrong keys) → AI_PROVIDER_BAD_RESPONSE', async () => {
  const provider = new FakeProvider(JSON.stringify({ story: 'x', factors: 'not-an-array' }));
  const { service } = makeService({ provider });
  await assert.rejects(
    service.narrative('cash-flow', {}, ACTOR),
    (err: unknown) => err instanceof UpstreamError && err.code === 'AI_PROVIDER_BAD_RESPONSE',
  );
});

test('disabled runtime → 503 AI_DISABLED before any provider/report work', async () => {
  const provider = new FakeProvider(GOOD_OUTPUT);
  const { service, created } = makeService({
    provider,
    runtime: { enabled: false, reason: 'NO_API_KEY' },
  });
  await assert.rejects(
    service.narrative('cash-flow', {}, ACTOR),
    (err: unknown) =>
      err instanceof AppError && err.statusCode === 503 && err.code === 'AI_DISABLED',
  );
  assert.equal(provider.calls.length, 0);
  assert.equal(created.length, 0);
});

// ---------- Phase 3: queryFromText (NL → gate → ReportsService) ----------

const NL_QUERY_JSON = JSON.stringify({
  reportType: 'cash-flow',
  filters: { dateFrom: '2026-07-01', dateTo: '2026-07-31' },
});

test('nl-query happy path: validated query executes and is governed', async () => {
  const provider = new FakeProvider(NL_QUERY_JSON);
  const { service, created, logged, reportsCalls } = makeService({ provider });

  const out = await service.queryFromText('كم صافي التدفق النقدي لهذا الشهر؟', false, ACTOR);

  // Query understood + typed (dates coerced by the gate).
  assert.equal(out.query.reportType, 'cash-flow');
  assert.equal(out.modelUsed, 'test/default-model');
  assert.deepEqual(out.result, { totalRevenue: '15000.00', netCashFlow: '3000.00' });

  // The report executed through the PUBLIC ReportsService with Date args.
  assert.equal(reportsCalls.length, 1);
  assert.equal(reportsCalls[0]!.method, 'getCashFlow');
  const args = reportsCalls[0]!.args as { dateFrom: Date; dateTo: Date };
  assert.ok(args.dateFrom instanceof Date);

  // Governance: NL_REPORT_QUERY row + audit entry.
  assert.equal(created.length, 1);
  assert.equal(created[0]!.operationType, 'NL_REPORT_QUERY');
  assert.match(created[0]!.outputSummary, /nl-query: cash-flow/);
  assert.equal(logged.length, 1);
});

test('nl-query: out-of-scope refusal → 422, NO report executed, call still logged', async () => {
  const provider = new FakeProvider(
    JSON.stringify({ outOfScope: true, reason: 'طلب حذف بيانات' }),
  );
  const { service, created, reportsCalls } = makeService({ provider });

  await assert.rejects(
    service.queryFromText('احذف كل العملاء', false, ACTOR),
    (err: unknown) => err instanceof AppError && err.code === 'AI_QUERY_OUT_OF_SCOPE',
  );
  assert.equal(reportsCalls.length, 0);
  assert.equal(created.length, 1);
  assert.match(created[0]!.outputSummary, /rejected: AI_QUERY_OUT_OF_SCOPE/);
});

test('nl-query: hallucinated non-whitelist query → 422, nothing reaches ReportsService', async () => {
  const provider = new FakeProvider(
    JSON.stringify({
      reportType: 'project-financial-risk',
      filters: { budgetExceeded: true, noPaymentsForDays: 30 },
      groupBy: 'project',
      sortBy: 'riskScore',
    }),
  );
  const { service, created, reportsCalls } = makeService({ provider });

  await assert.rejects(
    service.queryFromText('أي المشاريع الأخطر ماليًا؟', false, ACTOR),
    (err: unknown) => err instanceof AppError && err.code === 'AI_QUERY_REJECTED',
  );
  assert.equal(reportsCalls.length, 0);
  assert.equal(created.length, 1);
  assert.match(created[0]!.outputSummary, /rejected: AI_QUERY_REJECTED/);
});

test('nl-query: non-JSON model output → gentle bad-response error, logged, no execution', async () => {
  const provider = new FakeProvider('يمكنك رؤية التدفق النقدي من صفحة التقارير.');
  const { service, created, reportsCalls } = makeService({ provider });

  await assert.rejects(
    service.queryFromText('وين أشوف الفلوس؟', false, ACTOR),
    (err: unknown) => err instanceof UpstreamError && err.code === 'AI_PROVIDER_BAD_RESPONSE',
  );
  assert.equal(reportsCalls.length, 0);
  assert.equal(created.length, 1);
});

test('nl-query: fenced JSON tolerated; profitability maps sort + fixed paging', async () => {
  const provider = new FakeProvider(
    '```json\n' +
      JSON.stringify({
        reportType: 'project-profitability',
        filters: { status: 'IN_PROGRESS' },
        sortBy: 'name',
        sortDir: 'asc',
      }) +
      '\n```',
  );
  const { service, reportsCalls } = makeService({ provider });

  const out = await service.queryFromText('ربحية مشاريع قيد التنفيذ بالاسم', false, ACTOR);
  assert.equal(out.query.reportType, 'project-profitability');
  assert.deepEqual(reportsCalls[0]!.args, {
    page: 1,
    pageSize: 20,
    status: 'IN_PROGRESS',
    sortBy: 'name',
    sortDir: 'asc',
  });
});

test('nl-query narrate=true chains the Phase-2 narrative (two governed calls)', async () => {
  const provider = new FakeProvider([NL_QUERY_JSON, GOOD_OUTPUT]);
  const { service, created } = makeService({ provider });

  const out = await service.queryFromText('التدفق النقدي لهذا الشهر مع تفسير', true, ACTOR);
  assert.ok(out.narrative);
  assert.match(out.narrative!.narrative, /صافي التدفق/);
  assert.equal(provider.calls.length, 2);
  assert.deepEqual(
    created.map((c) => c.operationType),
    ['NL_REPORT_QUERY', 'REPORT_NARRATIVE'],
  );
});

test('nl-query narrate=true: narrative failure never voids the query result', async () => {
  const provider = new FakeProvider([NL_QUERY_JSON, 'ليس JSON']);
  const { service } = makeService({ provider });

  const out = await service.queryFromText('التدفق النقدي مع تفسير', true, ACTOR);
  assert.equal(out.query.reportType, 'cash-flow');
  assert.equal(out.narrative, undefined);
});

// ---------- AiContextService (the safe-DTO layer) ----------

test('cash-flow context: money pre-formatted with the default currency settings', async () => {
  const context = await fakeContextDeps().buildReportContext('cash-flow', {});
  assert.equal(context.currencyLabel, 'د.ع (IQD)');
  // formatMoney joins number and symbol with a NON-BREAKING space (U+00A0).
  assert.equal((context.data as Record<string, unknown>).totalRevenue, '15,000 د.ع');
  assert.equal((context.data as Record<string, unknown>).netCashFlow, '3,000 د.ع');
  assert.deepEqual(context.sourceModules, ['reports']);
});

test('delayed-projects context strips customer identifiers and caps rows', async () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({
    projectId: `p-${i}`,
    name: `مشروع ${i}`,
    status: 'IN_PROGRESS',
    contractId: `c-${i}`,
    contractNumber: `CN-${i}`,
    customerId: `cust-${i}`,
    customerName: 'عميل سري جدًا',
    startDate: new Date('2026-01-01'),
    deliveryDate: new Date('2026-06-01'),
    progressPercentage: 40,
    daysDelayed: 10 + i,
  }));
  const context = await fakeContextDeps({
    getDelayedProjects: async () => rows,
  }).buildReportContext('delayed-projects', {});

  const serialized = JSON.stringify(context.data);
  assert.ok(!serialized.includes('customerName'));
  assert.ok(!serialized.includes('عميل سري جدًا'));
  assert.ok(!serialized.includes('cust-0'));

  const data = context.data as { totalCount: number; truncated: boolean; projects: unknown[] };
  assert.equal(data.totalCount, 30);
  assert.equal(data.projects.length, 25);
  assert.equal(data.truncated, true);
  assert.equal(context.recordIds.length, 25);
  assert.equal(context.recordIds[0], 'p-0');
});
