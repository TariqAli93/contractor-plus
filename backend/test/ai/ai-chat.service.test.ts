/**
 * Phase-7 tests for the chat orchestrator: the read-only tool round goes
 * through the REAL validation gate before executing, mutations are impossible,
 * general questions skip the tool, threads are owner-scoped, and the governance
 * log stays content-free. Provider/repo/reports faked; AiValidationService is
 * the real gate.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { AiChatService } from '../../src/modules/ai-assistant/services/ai-chat.service.js';
import { AiValidationService } from '../../src/modules/ai-assistant/services/ai-validation.service.js';
import { CHAT_QUERY_TOOL_NAME } from '../../src/modules/ai-assistant/prompts/chat-system.js';
import type { AiSettingsService } from '../../src/modules/ai-assistant/services/ai-settings.service.js';
import type { AiBudgetService } from '../../src/modules/ai-assistant/services/ai-budget.service.js';
import type { AiAssistantRepository } from '../../src/modules/ai-assistant/ai-assistant.repository.js';
import type { CreateAiRequestLogInput } from '../../src/modules/ai-assistant/ai-assistant.types.js';
import type { AuditActor, AuditLogInput, AuditService } from '../../src/modules/audit/audit.service.js';
import type { ReportsService } from '../../src/modules/reports/reports.service.js';
import type {
  AiCompletionInput,
  AiCompletionResult,
  AiProvider,
  AiToolCall,
} from '../../src/lib/ai/ai-provider.interface.js';
import { AppError } from '../../src/shared/errors/app-error.js';
import { NotFoundError } from '../../src/shared/errors/not-found.error.js';

const ACTOR: AuditActor = { userId: 'user-1' };
const CONFIG = {
  apiKey: 'k',
  baseUrl: 'b',
  modelDefault: 'test/model',
  modelHeavy: 'test/heavy',
  timeoutMs: 5000,
};

// A provider returning a scripted sequence of responses (round 1, round 2…).
class ScriptedProvider implements AiProvider {
  calls: AiCompletionInput[] = [];
  constructor(private readonly responses: Array<{ content?: string; toolCalls?: AiToolCall[] }>) {}
  async complete(input: AiCompletionInput): Promise<AiCompletionResult> {
    const r = this.responses[Math.min(this.calls.length, this.responses.length - 1)]!;
    this.calls.push(input);
    return {
      content: r.content ?? '',
      ...(r.toolCalls ? { toolCalls: r.toolCalls } : {}),
      modelUsed: input.model,
      usage: { promptTokens: 100, completionTokens: 40 },
    };
  }
}

interface ThreadRow { id: string; userId: string; title: string; createdAt: Date; updatedAt: Date }
interface MessageRow {
  id: string; threadId: string; role: string; content: string;
  toolCalls?: unknown; toolResult?: unknown; createdAt: Date;
}

function fakeRepo(seed: { threads?: ThreadRow[]; messages?: MessageRow[] } = {}) {
  const threads = seed.threads ?? [];
  const messages = seed.messages ?? [];
  const logs: CreateAiRequestLogInput[] = [];
  let n = 0;
  const repo = {
    listThreads: async (userId: string) =>
      threads.filter((t) => t.userId === userId).sort((a, b) => +b.updatedAt - +a.updatedAt),
    findThreadForUser: async (threadId: string, userId: string) => {
      const t = threads.find((x) => x.id === threadId && x.userId === userId);
      if (!t) return null;
      return { ...t, messages: messages.filter((m) => m.threadId === threadId) };
    },
    createThread: async (data: { userId: string; title: string }) => {
      const t: ThreadRow = { id: `t-${++n}`, ...data, createdAt: new Date(), updatedAt: new Date() };
      threads.push(t);
      return t;
    },
    touchThread: async (id: string) => threads.find((t) => t.id === id)!,
    deleteThreadForUser: async (threadId: string, userId: string) => {
      const before = threads.length;
      const kept = threads.filter((t) => !(t.id === threadId && t.userId === userId));
      threads.length = 0;
      threads.push(...kept);
      return before - threads.length;
    },
    createMessage: async (data: Omit<MessageRow, 'id' | 'createdAt'>) => {
      const m: MessageRow = { id: `m-${++n}`, createdAt: new Date(), ...data };
      messages.push(m);
      return m;
    },
    createRequestLog: async (data: CreateAiRequestLogInput) => {
      logs.push(data);
      return { id: `log-${++n}` };
    },
  } as unknown as AiAssistantRepository;
  return { repo, threads, messages, logs };
}

function fakeAudit() {
  const logged: Array<{ actor: AuditActor; input: AuditLogInput }> = [];
  return {
    audit: { log: async (a: AuditActor, i: AuditLogInput) => { logged.push({ actor: a, input: i }); } } as unknown as AuditService,
    logged,
  };
}

function fakeReports() {
  const calls: string[] = [];
  const reports = {
    getCashFlow: async () => { calls.push('getCashFlow'); return { totalRevenue: '15000.00', netCashFlow: '3000.00' }; },
    getDelayedProjects: async () => { calls.push('getDelayedProjects'); return []; },
    getOverduePayments: async () => { calls.push('getOverduePayments'); return []; },
    listProjectProfitability: async () => { calls.push('listProjectProfitability'); return { items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 }; },
  } as unknown as ReportsService;
  return { reports, calls };
}

function makeService(opts: {
  provider: AiProvider;
  featureEnabled?: boolean;
  overBudget?: boolean;
  repoSeed?: Parameters<typeof fakeRepo>[0];
}) {
  const enabled = opts.featureEnabled ?? true;
  const settings = {
    requireProviderForFeature: async () => {
      if (!enabled) throw new AppError(503, 'AI_FEATURE_DISABLED', 'off');
      return { provider: opts.provider, config: CONFIG };
    },
    // Capability guard is best-effort; the fake model is unknown → fails open.
    assertModelSupportsTools: async () => {},
  } as unknown as AiSettingsService;
  const budget = {
    assertWithinBudget: async () => {
      if (opts.overBudget) throw new AppError(429, 'AI_BUDGET_EXCEEDED', 'over');
    },
  } as unknown as AiBudgetService;
  const { repo, threads, messages, logs } = fakeRepo(opts.repoSeed);
  const { audit, logged } = fakeAudit();
  const { reports, calls: reportCalls } = fakeReports();
  const service = new AiChatService({
    settings, budget, repo, audit, reports, validation: new AiValidationService(),
  });
  return { service, threads, messages, logs, logged, reportCalls };
}

const toolCall = (args: unknown): AiToolCall[] => [
  { id: 'call-1', name: CHAT_QUERY_TOOL_NAME, argumentsJson: JSON.stringify(args) },
];

// ---------- tool round through the gate ----------

test('data question → validated tool query executes → composed answer, governed', async () => {
  const provider = new ScriptedProvider([
    { toolCalls: toolCall({ reportType: 'cash-flow', filters: { dateFrom: '2026-07-01', dateTo: '2026-07-31' } }) },
    { content: 'صافي التدفق النقدي 3,000 د.ع لهذا الشهر.' },
  ]);
  const { service, messages, logs, reportCalls } = makeService({ provider });

  const res = await service.send('كم صافي التدفق النقدي هذا الشهر؟', null, ACTOR);

  assert.match(res.message.content, /صافي التدفق/);
  assert.equal(res.message.toolReportType, 'cash-flow');
  // The report ran through the public service (once).
  assert.deepEqual(reportCalls, ['getCashFlow']);
  // Two provider rounds (tool call, then compose).
  assert.equal(provider.calls.length, 2);
  assert.equal(provider.calls[1]!.toolChoice, 'none'); // 2nd round forbids tools
  // Persisted user + assistant rows.
  assert.equal(messages.filter((m) => m.role === 'user').length, 1);
  assert.equal(messages.filter((m) => m.role === 'assistant').length, 1);
  // Governance: CHAT, content-free summary, source=reports.
  assert.equal(logs.length, 1);
  assert.equal(logs[0]!.operationType, 'CHAT');
  assert.match(logs[0]!.outputSummary, /chat: query cash-flow/);
  assert.deepEqual(logs[0]!.sourceModules, ['reports']);
  assert.equal(logs[0]!.tokensPrompt, 200); // summed across both rounds
});

test('out-of-scope tool args are rejected by the gate → NO report runs, model still answers', async () => {
  const provider = new ScriptedProvider([
    // The model hallucinates a non-whitelisted report/mutation-ish query.
    { toolCalls: toolCall({ reportType: 'delete-everything', filters: {} }) },
    { content: 'عذرًا، لا أستطيع تنفيذ ذلك.' },
  ]);
  const { service, reportCalls } = makeService({ provider });

  const res = await service.send('احذف كل العملاء', null, ACTOR);

  assert.match(res.message.content, /عذرًا/);
  assert.equal(res.message.toolReportType, undefined); // gate rejected → no report type
  assert.deepEqual(reportCalls, []); // NOTHING executed
  // The tool-result error was fed back so round 2 could apologise.
  const toolMsg = provider.calls[1]!.messages.find((m) => m.role === 'tool');
  assert.ok(toolMsg);
  assert.match(toolMsg!.content, /not allowed|error/);
});

test('a filter that is valid for another report is rejected (gate enforcement)', async () => {
  const provider = new ScriptedProvider([
    { toolCalls: toolCall({ reportType: 'cash-flow', filters: { status: 'IN_PROGRESS' } }) },
    { content: 'تعذّر.' },
  ]);
  const { service, reportCalls } = makeService({ provider });
  await service.send('...', null, ACTOR);
  assert.deepEqual(reportCalls, []); // status isn't a cash-flow filter → rejected
});

// ---------- general question (no tool) ----------

test('general question → direct answer, no tool, source empty', async () => {
  const provider = new ScriptedProvider([{ content: 'لإضافة مشروع، افتح صفحة المشاريع واضغط "مشروع جديد".' }]);
  const { service, logs, reportCalls } = makeService({ provider });
  const res = await service.send('كيف أضيف مشروعًا؟', null, ACTOR);
  assert.match(res.message.content, /مشروع جديد/);
  assert.equal(provider.calls.length, 1); // no second round
  assert.deepEqual(reportCalls, []);
  assert.equal(logs[0]!.outputSummary, 'chat: conversation');
  assert.deepEqual(logs[0]!.sourceModules, []);
});

// ---------- gate / budget ----------

test('chat feature disabled → 503 AI_FEATURE_DISABLED, nothing persisted', async () => {
  const provider = new ScriptedProvider([{ content: 'x' }]);
  const { service, messages } = makeService({ provider, featureEnabled: false });
  await assert.rejects(
    service.send('مرحبا', null, ACTOR),
    (e: unknown) => e instanceof AppError && e.code === 'AI_FEATURE_DISABLED',
  );
  assert.equal(messages.length, 0);
  assert.equal(provider.calls.length, 0);
});

test('over budget → 429, no provider call', async () => {
  const provider = new ScriptedProvider([{ content: 'x' }]);
  const { service } = makeService({ provider, overBudget: true });
  await assert.rejects(
    service.send('مرحبا', null, ACTOR),
    (e: unknown) => e instanceof AppError && e.code === 'AI_BUDGET_EXCEEDED',
  );
  assert.equal(provider.calls.length, 0);
});

// ---------- ownership isolation ----------

test('sending to another user\'s thread → NOT FOUND (owner-scoped)', async () => {
  const provider = new ScriptedProvider([{ content: 'x' }]);
  const { service } = makeService({
    provider,
    repoSeed: { threads: [{ id: 't-other', userId: 'someone-else', title: 'x', createdAt: new Date(), updatedAt: new Date() }] },
  });
  await assert.rejects(
    service.send('hi', 't-other', ACTOR),
    (e: unknown) => e instanceof NotFoundError,
  );
});

test('getThread / deleteThread reject a non-owned thread', async () => {
  const provider = new ScriptedProvider([{ content: 'x' }]);
  const { service } = makeService({
    provider,
    repoSeed: { threads: [{ id: 't-other', userId: 'someone-else', title: 'x', createdAt: new Date(), updatedAt: new Date() }] },
  });
  await assert.rejects(service.getThread('t-other', ACTOR), (e: unknown) => e instanceof NotFoundError);
  await assert.rejects(service.deleteThread('t-other', ACTOR), (e: unknown) => e instanceof NotFoundError);
});

test('continuing an owned thread includes prior turns as context', async () => {
  const provider = new ScriptedProvider([{ content: 'رد ثانٍ' }]);
  const { service, messages } = makeService({
    provider,
    repoSeed: {
      threads: [{ id: 't-1', userId: 'user-1', title: 'سابق', createdAt: new Date(), updatedAt: new Date() }],
      messages: [
        { id: 'm-a', threadId: 't-1', role: 'user', content: 'سؤال سابق', createdAt: new Date() },
        { id: 'm-b', threadId: 't-1', role: 'assistant', content: 'جواب سابق', createdAt: new Date() },
      ],
    },
  });
  await service.send('سؤال جديد', 't-1', ACTOR);
  // The provider saw the system prompt + 2 prior turns + the new user message.
  const roles = provider.calls[0]!.messages.map((m) => m.role);
  assert.deepEqual(roles, ['system', 'user', 'assistant', 'user']);
  assert.equal(messages.filter((m) => m.threadId === 't-1' && m.role === 'user').length, 2);
});
