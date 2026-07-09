import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../src/lib/prisma.js';
import { AssistantOrchestrator } from '../../src/modules/ai-assistant/assistant.orchestrator.js';
import { AuditQueryService } from '../../src/modules/ai-assistant/audit-query.service.js';
import { NO_PENDING_MESSAGE } from '../../src/modules/ai-assistant/capabilities.js';
import { LLMError, type LlmClient, type LlmCompletionRequest } from '../../src/lib/llm/llm-client.js';
import { RoleName } from '@contractor-plus/shared';

// ── Deterministic LLM stand-ins ──────────────────────────────────────────────
function makeLlm(
  handler: string | object | ((req: LlmCompletionRequest) => string | object),
  sink?: LlmCompletionRequest[],
): LlmClient {
  return {
    name: 'openrouter',
    model: 'test',
    complete: async (req) => {
      sink?.push(req);
      const out = typeof handler === 'function' ? handler(req) : handler;
      return typeof out === 'string' ? out : JSON.stringify(out);
    },
  };
}
/** Throws if the model is ever called — proves the deterministic pre-router path. */
function throwingLlm(): LlmClient {
  return { name: 'openrouter', model: 'test', complete: async () => { throw new Error('LLM must NOT be called on this path'); } };
}
function timeoutLlm(): LlmClient {
  return { name: 'openrouter', model: 'test', complete: async () => { throw new LLMError('openrouter', null, 'timeout', false); } };
}

const RUN = `ASSTTEST-${Date.now()}`;
const created = { sessions: new Set<string>() };
let ownerId: string;

const clientPlan = (name: string) => ({
  kind: 'workflow_plan', intent: 'client.create', confidence: 0.9, requiresConfirmation: true,
  missingSlots: [], steps: [{ action: 'client.create', data: { name } }], confirmationMessage: `راح أنشئ عميل باسم ${name}. تؤكد؟`,
});
const dashboardQuery = { kind: 'query', intent: 'report.dashboard', steps: [{ action: 'report.dashboard', data: {} }] };
const draftLlm = (area: number, materialName: string) => ({
  kind: 'draft',
  intent: { projectType: 'structural', constructionType: 'residential', scopeOfWork: 'test', templateName: `AsstTmpl ${RUN}`, areaValue: area, areaUnit: 'm2' },
  wastePercentage: 5, confidence: 0.85,
  items: [{ description: 'Reinforcement Steel', category: 'MATERIAL', materialNameGuess: materialName, ratioPerAreaUnit: 8, unitPrice: 1.5, unit: 'kg', notes: null }],
});

before(async () => {
  const users = await prisma.user.findMany({ select: { id: true, role: { select: { name: true } } } });
  ownerId = users.find((u) => u.role.name === RoleName.OWNER)?.id ?? users[0]!.id;
});

after(async () => {
  await prisma.aiExecution.deleteMany({ where: { sessionId: { in: [...created.sessions] } } });
  await prisma.aiSession.deleteMany({ where: { OR: [{ id: { in: [...created.sessions] } }, { title: { contains: RUN } }] } });
  await prisma.estimationAuditLog.deleteMany({ where: { originalCommand: { contains: RUN } } });
  await prisma.estimationTemplateDraft.deleteMany({ where: { originalCommand: { contains: RUN } } });
  await prisma.material.deleteMany({ where: { name: { contains: RUN } } });
  await prisma.customer.deleteMany({ where: { name: { contains: RUN } } });
  await prisma.$disconnect();
});

function principal(uid: string = ownerId) {
  return { userId: uid, role: RoleName.OWNER, actor: { userId: uid, ipAddress: '127.0.0.1', userAgent: 'test' } };
}
async function open(orch: AssistantOrchestrator, label: string) {
  const s = await orch.openSession(principal(), `ASST ${RUN} ${label}`);
  created.sessions.add(s.id);
  return s.id;
}

// ── 1) Iraqi help questions never hit the LLM / project-query path ───────────
test('every capability/help phrasing is answered deterministically (no LLM)', async () => {
  const phrases = ['شنو أكدر اسوي وياك', 'شنو تكدر تسوي', 'ساعدني', 'شنو اوامرك', 'ماذا تستطيع أن تفعل', 'ما هي الأوامر المتاحة'];
  const orch = new AssistantOrchestrator(prisma, throwingLlm());
  for (let i = 0; i < phrases.length; i++) {
    const id = await open(orch, `help${i}`);
    const msg = await orch.message(id, phrases[i]!, principal());
    assert.equal(msg.kind, 'answer', `"${phrases[i]}" must be answered, not routed to a tool`);
    const execs = await prisma.aiExecution.count({ where: { sessionId: id } });
    assert.equal(execs, 0, 'a deterministic answer consumes no execution/quota');
  }
});

// ── 2) The help answer carries the capability list + examples ────────────────
test('the help answer includes the capability list and example commands', async () => {
  const orch = new AssistantOrchestrator(prisma, throwingLlm());
  const id = await open(orch, 'caps');
  const msg = await orch.message(id, 'شنو تكدر تسوي', principal());
  assert.equal(msg.kind, 'answer');
  if (msg.kind !== 'answer') return;
  assert.match(msg.message, /أساعدك/);
  assert.ok((msg.suggestions?.length ?? 0) >= 3, 'example commands offered');
});

// ── 3) "ما في خطة" only for a bare confirm/cancel with nothing parked ────────
test('a bare confirm word with no pending plan returns exactly the no-plan message', async () => {
  const orch = new AssistantOrchestrator(prisma, throwingLlm());
  const id = await open(orch, 'noplan');
  const msg = await orch.message(id, 'نعم', principal());
  assert.equal(msg.kind, 'answer');
  if (msg.kind !== 'answer') return;
  assert.equal(msg.message, NO_PENDING_MESSAGE);
});

// ── 4) A normal command query routes to command and runs immediately ─────────
test('a normal query command routes to command and runs without confirmation', async () => {
  const orch = new AssistantOrchestrator(prisma, makeLlm(dashboardQuery));
  const id = await open(orch, 'query');
  const msg = await orch.message(id, `شكد عندي مشاريع اليوم ${RUN}`, principal());
  assert.equal(msg.kind, 'query', 'an ordinary question never yields the no-pending message');
  if (msg.kind === 'query') assert.equal(msg.toolName, 'command');
});

// ── 5) A normal client command previews then confirms, creating the record ───
test('a client command previews then confirms, creating the customer + audit', async () => {
  const name = `AITEST ${RUN} Ali`;
  const orch = new AssistantOrchestrator(prisma, makeLlm(clientPlan(name)));
  const id = await open(orch, 'client');
  const preview = await orch.message(id, `أضف عميل باسم ${name}`, principal());
  assert.equal(preview.kind, 'preview');
  if (preview.kind !== 'preview') return;
  assert.equal(preview.toolName, 'command');

  const parked = await prisma.aiSession.findUnique({ where: { id } });
  assert.equal(parked?.status, 'AWAITING_CONFIRMATION');

  const done = await orch.confirm(id, principal());
  assert.equal(done.kind, 'execution');
  assert.ok(await prisma.customer.findFirst({ where: { name } }), 'customer created');
  const exec = await prisma.aiExecution.findFirst({ where: { sessionId: id, transactionResult: 'executed' } });
  assert.equal(exec?.toolName, 'command', 'unified audit row tagged to the command tool');
});

// ── 6) An estimation-template command routes to the estimation tool ──────────
test('an estimation-template command routes to the estimation tool', async () => {
  await prisma.material.create({ data: { name: `Steel ${RUN}`, unit: 'kg', defaultPrice: 1.5, isActive: true } });
  const orch = new AssistantOrchestrator(prisma, makeLlm(draftLlm(200, `Steel ${RUN}`)));
  const id = await open(orch, 'est');
  const msg = await orch.message(id, 'أنشئ قالب تقدير لبناء بيت 200 متر', principal());
  assert.equal(msg.kind, 'preview');
  if (msg.kind !== 'preview') return;
  assert.equal(msg.renderKind, 'estimation', 'user did not need to know which system answered');
});

// ── 7) An estimation timeout surfaces a friendly Arabic error, not a raw throw ─
test('an estimation timeout returns a friendly Arabic error result', async () => {
  const orch = new AssistantOrchestrator(prisma, timeoutLlm());
  const id = await open(orch, 'timeout');
  const msg = await orch.message(id, 'أنشئ قالب تقدير لبيت كبير', principal());
  assert.equal(msg.kind, 'error');
  if (msg.kind !== 'error') return;
  assert.equal(msg.reason, 'timeout');
  assert.match(msg.message, /التقدير/, 'the estimation-specific timeout copy');
});

// ── 8) ConversationMemory threads the prior turn into the next LLM prompt ─────
test('conversation memory carries the prior turn into the next prompt', async () => {
  const sink: LlmCompletionRequest[] = [];
  const orch = new AssistantOrchestrator(prisma, makeLlm(dashboardQuery, sink));
  const id = await open(orch, 'memory');
  const first = `شكد مشاريعي المتأخرة ${RUN}`;
  await orch.message(id, first, principal());
  await orch.message(id, 'وشكد المصاريف؟', principal());
  assert.equal(sink.length, 2, 'both turns invoked the model');
  assert.match(sink[1]!.user, /سياق المحادثة السابقة/, 'second turn carries a memory preamble');
  assert.ok(sink[1]!.user.includes(first), 'the preamble contains the first turn verbatim');
});

// ── 9) Sessions are independent — a parked plan does not leak across sessions ─
test('a pending plan in one session does not leak into another', async () => {
  const orch = new AssistantOrchestrator(prisma, makeLlm(clientPlan(`AITEST ${RUN} Sw`)));
  const a = await open(orch, 'A');
  const b = await open(orch, 'B');
  const pa = await orch.message(a, `أضف عميل باسم AITEST ${RUN} Sw`, principal());
  assert.equal(pa.kind, 'preview', 'session A parks a plan');

  const mb = await orch.message(b, 'نعم', principal());
  assert.equal(mb.kind, 'answer');
  if (mb.kind === 'answer') assert.equal(mb.message, NO_PENDING_MESSAGE, 'session B has nothing to confirm');

  assert.equal((await prisma.aiSession.findUnique({ where: { id: a } }))?.status, 'AWAITING_CONFIRMATION');
  assert.notEqual((await prisma.aiSession.findUnique({ where: { id: b } }))?.status, 'AWAITING_CONFIRMATION');
});

// ── 10) Exceeding the per-user quota returns a clear error, not silence ──────
test('exceeding the usage quota returns a clear error result', async () => {
  const orch = new AssistantOrchestrator(prisma, makeLlm(dashboardQuery), { quota: { daily: 0 } });
  const id = await open(orch, 'quota');
  const msg = await orch.message(id, `شكد مصاريفي ${RUN}`, principal());
  assert.equal(msg.kind, 'error');
  if (msg.kind !== 'error') return;
  assert.match(msg.reason, /quota/);
});

// ── 11) Two concurrent confirms execute the parked plan exactly once ─────────
test('two concurrent confirms execute the plan exactly once (atomic claim)', async () => {
  const name = `AITEST ${RUN} Race`;
  const orch = new AssistantOrchestrator(prisma, makeLlm(clientPlan(name)));
  const id = await open(orch, 'race');
  await orch.message(id, `أضف عميل باسم ${name}`, principal());
  const [r1, r2] = await Promise.all([orch.confirm(id, principal()), orch.confirm(id, principal())]);
  assert.deepEqual([r1.kind, r2.kind].sort(), ['execution', 'rejected'], 'exactly one executes');
  assert.equal((await prisma.customer.findMany({ where: { name } })).length, 1, 'created exactly once');
});

// ── 12) The unified audit trail spans command + estimation categories ────────
test('the unified audit query returns entries across command and estimation', async () => {
  const cmdOrch = new AssistantOrchestrator(prisma, makeLlm(dashboardQuery));
  const cs = await open(cmdOrch, 'auditcmd');
  await cmdOrch.message(cs, `شكد عندي ${RUN}`, principal());

  const estOrch = new AssistantOrchestrator(prisma, timeoutLlm());
  const es = await open(estOrch, 'auditest');
  await estOrch.message(es, `قالب تقدير ${RUN}`, principal());

  const audit = new AuditQueryService(prisma);
  const cmd = await audit.list({ toolName: 'command', limit: 100 });
  const est = await audit.list({ toolName: 'estimation', limit: 100 });
  assert.ok(cmd.items.some((i) => created.sessions.has(i.sessionId ?? '')), 'a command execution is in the trail');
  assert.ok(est.items.some((i) => created.sessions.has(i.sessionId ?? '')), 'an estimation execution is in the trail');
  assert.ok(cmd.items.every((i) => i.toolName === 'command'), 'the toolName filter is honoured');
});

// ── 13) A help word BEFORE a real command routes to the command, not a canned
//        answer (end-to-end proof of the pre-router false-positive fix). ───────
test('a help word before a real command routes to the command, not a canned answer', async () => {
  const name = `AITEST ${RUN} HelpCmd`;
  const orch = new AssistantOrchestrator(prisma, makeLlm(clientPlan(name)));
  const id = await open(orch, 'helpcmd');
  const msg = await orch.message(id, `ساعدني أضيف عميل باسم ${name}`, principal());
  assert.notEqual(msg.kind, 'answer', 'must not be a canned help answer');
  assert.equal(msg.kind, 'preview', 'routes to the command tool');
  if (msg.kind === 'preview') assert.equal(msg.toolName, 'command');
});
