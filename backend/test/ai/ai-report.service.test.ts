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
  constructor(
    private readonly content: string,
    private readonly usage = { promptTokens: 100, completionTokens: 50 },
  ) {}
  async complete(input: AiCompletionInput): Promise<AiCompletionResult> {
    this.calls.push(input);
    return { content: this.content, modelUsed: input.model, usage: this.usage };
  }
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
  const service = new AiReportService({
    runtime: opts.runtime ?? RUNTIME_ENABLED,
    provider: opts.provider ?? new FakeProvider(GOOD_OUTPUT),
    context: opts.context ?? fakeContextDeps(),
    repo,
    audit,
  });
  return { service, created, logged };
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

test('non-JSON model output → AI_PROVIDER_BAD_RESPONSE, nothing logged', async () => {
  const provider = new FakeProvider('التقرير يبدو جيدًا بشكل عام.');
  const { service, created, logged } = makeService({ provider });
  await assert.rejects(
    service.narrative('cash-flow', {}, ACTOR),
    (err: unknown) => err instanceof UpstreamError && err.code === 'AI_PROVIDER_BAD_RESPONSE',
  );
  assert.equal(created.length, 0);
  assert.equal(logged.length, 0);
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
