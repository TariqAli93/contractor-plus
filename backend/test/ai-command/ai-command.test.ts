import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { CostCategory, ContractStatus, PaymentStatus, Prisma } from '@prisma/client';
import { prisma } from '../../src/lib/prisma.js';
import { AiCommandWorkflowService } from '../../src/modules/ai-command-workflow/ai-command-workflow.service.js';
import { createLlmClient, LLMError, type LlmClient } from '../../src/lib/llm/llm-client.js';
import { RoleName } from '@contractor-plus/shared';

// A deterministic LLM stand-in: `complete()` returns a fixed canned plan, so the
// whole interpret → resolve → confirm → execute pipeline is exercised offline.
function fakeLlm(json: unknown): LlmClient {
  const text = typeof json === 'string' ? json : JSON.stringify(json);
  return { name: 'openai', model: 'test', complete: async () => text };
}

// Multi-turn stand-in: returns canned responses in order and records each user
// prompt (so a test can prove the refinement prompt was used on turn 2).
function scriptedLlm(responses: unknown[]): { client: LlmClient; prompts: string[] } {
  const prompts: string[] = [];
  let i = 0;
  const client: LlmClient = {
    name: 'openai',
    model: 'test',
    complete: async (req) => {
      prompts.push(req.user);
      const r = responses[Math.min(i, responses.length - 1)];
      i++;
      return typeof r === 'string' ? r : JSON.stringify(r);
    },
  };
  return { client, prompts };
}

const RUN = `AITEST-${Date.now()}`; // unique per run → easy, collision-free cleanup

const created = {
  customers: new Set<string>(),
  contracts: new Set<string>(),
  projects: new Set<string>(),
  payments: new Set<string>(),
  costs: new Set<string>(),
  sessions: new Set<string>(),
};

let userId: string;
let viewerUserId: string;

before(async () => {
  const users = await prisma.user.findMany({ select: { id: true, role: { select: { name: true } } } });
  assert.ok(users.length > 0, 'expected at least one seeded user');
  userId = users[0]!.id;
  viewerUserId = users.find((u) => u.role.name === RoleName.VIEWER)?.id ?? userId;
});

after(async () => {
  // Dependency order: payments/costs → projects → contracts → customers.
  await prisma.payment.deleteMany({
    where: { OR: [{ id: { in: [...created.payments] } }, { project: { name: { contains: RUN } } }] },
  });
  await prisma.projectCost.deleteMany({
    where: { OR: [{ id: { in: [...created.costs] } }, { project: { name: { contains: RUN } } }] },
  });
  await prisma.project.deleteMany({
    where: { OR: [{ id: { in: [...created.projects] } }, { name: { contains: RUN } }] },
  });
  await prisma.contract.deleteMany({
    where: {
      OR: [{ id: { in: [...created.contracts] } }, { customer: { name: { contains: RUN } } }, { contractNumber: { contains: RUN } }],
    },
  });
  await prisma.customer.deleteMany({
    where: { OR: [{ id: { in: [...created.customers] } }, { name: { contains: RUN } }] },
  });
  await prisma.aiCommandLog.deleteMany({ where: { sessionId: { in: [...created.sessions] } } });
  await prisma.$disconnect();
});

function principal(role: string = RoleName.OWNER, uid: string = userId) {
  return { userId: uid, role, actor: { userId: uid, ipAddress: '127.0.0.1', userAgent: 'test' } };
}

function svc(json: unknown): AiCommandWorkflowService {
  return new AiCommandWorkflowService(prisma, fakeLlm(json));
}

function track(res: unknown): void {
  const r = res as { sessionId?: string; kind?: string; createdEntityIds?: Record<string, string> };
  if (r.sessionId) created.sessions.add(r.sessionId);
  if (r.kind === 'execution' && r.createdEntityIds) {
    for (const [k, v] of Object.entries(r.createdEntityIds)) {
      if (k === 'client') created.customers.add(v);
      else if (k === 'contract') created.contracts.add(v);
      else if (k === 'project') created.projects.add(v);
      else if (k === 'payment') created.payments.add(v);
      else if (k === 'expense') created.costs.add(v);
    }
  }
}

function newClientPlan(clientName: string, projectName: string) {
  return {
    kind: 'workflow_plan',
    intent: 'project.create_with_client_contract',
    confidence: 0.92,
    requiresConfirmation: true,
    missingSlots: [],
    steps: [
      { action: 'client.find_or_create', data: { name: clientName } },
      { action: 'contract.create', data: { clientRef: clientName, area: 200 } },
      { action: 'project.create', data: { name: projectName, clientRef: clientName, contractRef: 'created_contract', area: 200 } },
    ],
    confirmationMessage: 'راح أنشئ عميل وعقد ومشروع. هل تؤكد؟',
  };
}

// 1) Create-project for a NEW client → a 3-step confirmation plan.
test('new-client command yields a 3-step confirmation plan', async () => {
  const name = `عميل ${RUN} ن1`;
  const res = await svc(newClientPlan(name, `مشروع ${RUN} ن1`)).interpret('سويلي مشروع باسم فلان مساحة 200', undefined, principal());
  track(res);
  assert.equal(res.kind, 'workflow_plan');
  if (res.kind !== 'workflow_plan') return;
  assert.equal(res.steps.length, 3);
  assert.ok(res.confirmationMessage.length > 0);
});

// 2) Existing client → reuse it; only contract + project are created.
test('existing-client command reuses the client (no new customer)', async () => {
  const name = `عميل ${RUN} موجود`;
  const seeded = await prisma.customer.create({ data: { name } });
  created.customers.add(seeded.id);

  const s = svc(newClientPlan(name, `مشروع ${RUN} موجود`));
  const plan = await s.interpret('افتح مشروع للعميل الموجود', undefined, principal());
  track(plan);
  assert.equal(plan.kind, 'workflow_plan');
  if (plan.kind !== 'workflow_plan') return;

  const exec = await s.confirm(plan.sessionId, principal());
  track(exec);
  assert.equal(exec.kind, 'execution');
  if (exec.kind !== 'execution') return;
  assert.equal(exec.createdEntityIds.client, undefined, 'must NOT create a new client');
  assert.ok(exec.createdEntityIds.contract, 'contract created');
  assert.ok(exec.createdEntityIds.project, 'project created');

  const contract = await prisma.contract.findUnique({ where: { id: exec.createdEntityIds.contract } });
  assert.equal(contract?.customerId, seeded.id, 'contract linked to the existing customer');
});

// 3) Internal project ("لنفسي") → a standalone project, no client, no contract.
test('internal-project command creates a standalone project', async () => {
  const projectName = `مشروع ${RUN} داخلي`;
  const plan = {
    kind: 'workflow_plan',
    intent: 'project.create_internal',
    confidence: 0.9,
    steps: [{ action: 'project.create', data: { name: projectName } }],
    confirmationMessage: 'راح أنشئ مشروع داخلي. هل تؤكد؟',
  };
  const s = svc(plan);
  const res = await s.interpret('سويلي مشروع لنفسي', undefined, principal());
  track(res);
  assert.equal(res.kind, 'workflow_plan');
  if (res.kind !== 'workflow_plan') return;
  const exec = await s.confirm(res.sessionId, principal());
  track(exec);
  assert.equal(exec.kind, 'execution');
  if (exec.kind !== 'execution') return;
  const project = await prisma.project.findUnique({ where: { id: exec.createdEntityIds.project! } });
  assert.equal(project?.contractId, null, 'internal project has no contract');
});

// 4) Missing required slot → clarification (program-side detection).
test('a plan missing the area slot yields a clarification', async () => {
  const name = `عميل ${RUN} ناقص`;
  const plan = {
    kind: 'workflow_plan',
    intent: 'project.create_with_client_contract',
    confidence: 0.8,
    steps: [
      { action: 'client.find_or_create', data: { name } },
      { action: 'contract.create', data: { clientRef: name } }, // area MISSING
      { action: 'project.create', data: { name: `مشروع ${RUN} ناقص` } },
    ],
    confirmationMessage: 'x',
  };
  const res = await svc(plan).interpret('سويلي مشروع باسم فلان', undefined, principal());
  track(res);
  assert.equal(res.kind, 'clarification');
  if (res.kind !== 'clarification') return;
  assert.ok(res.missingSlots.includes('area'));
});

// 5) Confirm executes → the entities really exist.
test('confirming a plan executes it and persists the rows', async () => {
  const name = `عميل ${RUN} تنفيذ`;
  const s = svc(newClientPlan(name, `مشروع ${RUN} تنفيذ`));
  const plan = await s.interpret('سوي عقد ومشروع', undefined, principal());
  track(plan);
  assert.equal(plan.kind, 'workflow_plan');
  if (plan.kind !== 'workflow_plan') return;
  const exec = await s.confirm(plan.sessionId, principal());
  track(exec);
  assert.equal(exec.kind, 'execution');
  const customer = await prisma.customer.findFirst({ where: { name } });
  assert.ok(customer, 'customer persisted');
});

// 6) Cancel → nothing is executed.
test('cancelling a pending plan executes nothing', async () => {
  const name = `عميل ${RUN} إلغاء`;
  const s = svc(newClientPlan(name, `مشروع ${RUN} إلغاء`));
  const plan = await s.interpret('سويلي مشروع', undefined, principal());
  track(plan);
  assert.equal(plan.kind, 'workflow_plan');
  if (plan.kind !== 'workflow_plan') return;
  const res = await s.cancel(plan.sessionId, principal());
  assert.equal(res.kind, 'cancelled');
  const customer = await prisma.customer.findFirst({ where: { name } });
  assert.equal(customer, null, 'no customer created on cancel');
});

// 7) Project summary → a read-only query result (no confirmation).
test('project summary returns a query result', async () => {
  const customer = await prisma.customer.create({ data: { name: `عميل ${RUN} ملخص` } });
  created.customers.add(customer.id);
  const contract = await prisma.contract.create({
    data: {
      contractNumber: `${RUN}-SUM`,
      customerId: customer.id,
      buildingArea: new Prisma.Decimal(100),
      floors: 1,
      meterPrice: new Prisma.Decimal(1000),
      totalPrice: new Prisma.Decimal(100000),
      status: ContractStatus.APPROVED,
    },
  });
  created.contracts.add(contract.id);
  const projectName = `مشروع ${RUN} ملخص`;
  const project = await prisma.project.create({ data: { name: projectName, contractId: contract.id } });
  created.projects.add(project.id);
  const pay = await prisma.payment.create({
    data: { projectId: project.id, amount: new Prisma.Decimal(25000), dueDate: new Date(), status: PaymentStatus.PAID, paymentDate: new Date() },
  });
  created.payments.add(pay.id);
  const cost = await prisma.projectCost.create({
    data: { projectId: project.id, category: CostCategory.MATERIAL, description: 'اسمنت', totalAmount: new Prisma.Decimal(5000), date: new Date() },
  });
  created.costs.add(cost.id);

  const plan = { kind: 'query', intent: 'project.summary', steps: [{ action: 'project.summary', data: { projectRef: projectName } }] };
  const res = await svc(plan).interpret('وين وصلت بالمشروع؟', undefined, principal());
  track(res);
  assert.equal(res.kind, 'query');
  if (res.kind !== 'query') return;
  const data = res.data as { project?: { name?: string }; financials?: unknown };
  assert.ok(data.project?.name?.includes(RUN));
  assert.ok(data.financials, 'financials present');
});

// 8) Update → confirmation message shows the OLD and NEW value (DB-sourced).
test('update command shows old → new in the confirmation', async () => {
  const customer = await prisma.customer.create({ data: { name: `عميل ${RUN} تعديل` } });
  created.customers.add(customer.id);
  const contract = await prisma.contract.create({
    data: {
      contractNumber: `${RUN}-UPD`,
      customerId: customer.id,
      buildingArea: new Prisma.Decimal(200),
      floors: 1,
      meterPrice: new Prisma.Decimal(1000),
      totalPrice: new Prisma.Decimal(200000),
      status: ContractStatus.DRAFT,
    },
  });
  created.contracts.add(contract.id);
  const projectName = `مشروع ${RUN} تعديل`;
  const project = await prisma.project.create({ data: { name: projectName, contractId: contract.id } });
  created.projects.add(project.id);

  const plan = {
    kind: 'workflow_plan',
    intent: 'project.update',
    confidence: 0.9,
    steps: [{ action: 'project.update', data: { projectRef: projectName, area: 250 } }],
    confirmationMessage: 'x',
  };
  const res = await svc(plan).interpret('غير مساحة المشروع إلى 250', undefined, principal());
  track(res);
  assert.equal(res.kind, 'workflow_plan');
  if (res.kind !== 'workflow_plan') return;
  assert.match(res.confirmationMessage, /200/);
  assert.match(res.confirmationMessage, /250/);
});

// 9) Unregistered action → rejected (the AI cannot invent actions).
test('a plan with an unregistered action is rejected', async () => {
  const plan = {
    kind: 'workflow_plan',
    intent: 'evil',
    confidence: 0.9,
    steps: [{ action: 'database.drop_all', data: {} }],
    confirmationMessage: 'x',
  };
  const res = await svc(plan).interpret('احذف كل شيء', undefined, principal());
  track(res);
  assert.equal(res.kind, 'rejected');
  if (res.kind !== 'rejected') return;
  assert.equal(res.reason, 'unregistered_action');
});

// 10) Missing permission → rejected.
test('a command the role cannot perform is rejected', async () => {
  const plan = {
    kind: 'workflow_plan',
    intent: 'project.create_internal',
    confidence: 0.9,
    steps: [{ action: 'project.create', data: { name: `مشروع ${RUN} صلاحية` } }],
    confirmationMessage: 'x',
  };
  const res = await svc(plan).interpret('سوي مشروع', undefined, principal(RoleName.VIEWER, viewerUserId));
  track(res);
  assert.equal(res.kind, 'rejected');
  if (res.kind !== 'rejected') return;
  assert.equal(res.reason, 'insufficient_permission');
});

// 11) A step failing inside a workflow rolls the whole transaction back.
test('a failing step rolls back everything created before it', async () => {
  const name = `عميل ${RUN} رجوع`;
  // client + standalone project + payment. The payment fails (project has no
  // contract), so the customer + project must be rolled back.
  const plan = {
    kind: 'workflow_plan',
    intent: 'rollback.case',
    confidence: 0.9,
    steps: [
      { action: 'client.find_or_create', data: { name } },
      { action: 'project.create', data: { name: `مشروع ${RUN} رجوع` } },
      { action: 'payment.create', data: { amount: 100 } },
    ],
    confirmationMessage: 'x',
  };
  const s = svc(plan);
  const built = await s.interpret('سوي عميل ومشروع ودفعة', undefined, principal());
  track(built);
  assert.equal(built.kind, 'workflow_plan');
  if (built.kind !== 'workflow_plan') return;
  const res = await s.confirm(built.sessionId, principal());
  track(res);
  assert.equal(res.kind, 'rejected', 'execution should fail');
  const customer = await prisma.customer.findFirst({ where: { name } });
  assert.equal(customer, null, 'customer must be rolled back');
});

// ---- Enhancement pass: providers, queries, edits, resolution, multi-turn ----

// 12) The provider factory builds a client for all five providers.
test('createLlmClient supports all five providers', () => {
  for (const provider of ['openai', 'groq', 'anthropic', 'gemini', 'openrouter'] as const) {
    const c = createLlmClient({ enabled: true, provider, model: 'm', baseUrl: 'http://x', apiKey: 'k', timeoutMs: 1000, maxTokens: 10 });
    assert.equal(c?.name, provider);
  }
  const disabled = createLlmClient({ enabled: false, provider: 'openai', model: 'm', baseUrl: 'x', apiKey: 'k', timeoutMs: 1, maxTokens: 1 });
  assert.equal(disabled, null);
});

// 13) An LLM failure maps to a clear, code-specific Arabic message.
test('an LLM failure maps to a clear Arabic message', async () => {
  const errClient: LlmClient = {
    name: 'openai',
    model: 'test',
    complete: async () => {
      throw new LLMError('openai', 429, 'rate_limited', true);
    },
  };
  const res = await new AiCommandWorkflowService(prisma, errClient).interpret('سوي مشروع', undefined, principal());
  track(res);
  assert.equal(res.kind, 'rejected');
  if (res.kind !== 'rejected') return;
  assert.equal(res.reason, 'rate_limited');
  assert.match(res.message, /مشغول/);
});

// 14) A reports query (overdue payments) returns a read-only query result.
test('overdue-payments command returns a query result', async () => {
  const plan = { kind: 'query', intent: 'report.overdue_payments', steps: [{ action: 'report.overdue_payments', data: {} }] };
  const res = await svc(plan).interpret('منو أكثر عميل متأخر؟', undefined, principal());
  track(res);
  assert.equal(res.kind, 'query');
});

// 15) The proactive insights briefing is available to a reports-permitted user.
test('insights briefing is available for a reports-permitted user', async () => {
  const ins = await svc({}).getInsights(principal());
  assert.equal(ins.hasReports, true);
  assert.ok(ins.message.length > 0);
});

// 16) customer.update changes the phone (confirmed).
test('customer.update changes the phone', async () => {
  const name = `عميل ${RUN} هاتف`;
  const seeded = await prisma.customer.create({ data: { name, phone: '0770' } });
  created.customers.add(seeded.id);
  const plan = {
    kind: 'workflow_plan',
    intent: 'customer.update',
    confidence: 0.9,
    steps: [{ action: 'customer.update', data: { customerRef: name, phone: '07711112222' } }],
    confirmationMessage: 'x',
  };
  const s = svc(plan);
  const built = await s.interpret('بدل رقم الهاتف', undefined, principal());
  track(built);
  assert.equal(built.kind, 'workflow_plan');
  if (built.kind !== 'workflow_plan') return;
  const exec = await s.confirm(built.sessionId, principal());
  track(exec);
  assert.equal(exec.kind, 'execution');
  const after = await prisma.customer.findUnique({ where: { id: seeded.id } });
  assert.equal(after?.phone, '07711112222');
});

// 17) A customer can be resolved by phone number (fuzzy).
test('a customer resolves by phone number', async () => {
  const name = `عميل ${RUN} برقم`;
  const phone = `0790${Date.now().toString().slice(-6)}`;
  const seeded = await prisma.customer.create({ data: { name, phone } });
  created.customers.add(seeded.id);
  const plan = {
    kind: 'workflow_plan',
    intent: 'customer.update',
    confidence: 0.9,
    steps: [{ action: 'customer.update', data: { customerRef: phone, address: 'بغداد' } }],
    confirmationMessage: 'x',
  };
  const built = await svc(plan).interpret('حدث عنوان العميل', undefined, principal());
  track(built);
  assert.equal(built.kind, 'workflow_plan', 'resolved by phone → plan (not clarification)');
});

// 18) expense.delete removes the most-recent cost (confirmed).
test('expense.delete removes the most-recent cost', async () => {
  const customer = await prisma.customer.create({ data: { name: `عميل ${RUN} حذف` } });
  created.customers.add(customer.id);
  const contract = await prisma.contract.create({
    data: {
      contractNumber: `${RUN}-DEL`,
      customerId: customer.id,
      buildingArea: new Prisma.Decimal(100),
      floors: 1,
      meterPrice: new Prisma.Decimal(1000),
      totalPrice: new Prisma.Decimal(100000),
      status: ContractStatus.APPROVED,
    },
  });
  created.contracts.add(contract.id);
  const projectName = `مشروع ${RUN} حذف`;
  const project = await prisma.project.create({ data: { name: projectName, contractId: contract.id } });
  created.projects.add(project.id);
  const older = await prisma.projectCost.create({
    data: { projectId: project.id, category: CostCategory.MISC, description: 'قديم', totalAmount: new Prisma.Decimal(100), date: new Date() },
  });
  const newer = await prisma.projectCost.create({
    data: { projectId: project.id, category: CostCategory.MISC, description: 'أحدث', totalAmount: new Prisma.Decimal(200), date: new Date() },
  });
  created.costs.add(older.id);
  created.costs.add(newer.id);

  const plan = {
    kind: 'workflow_plan',
    intent: 'expense.delete',
    confidence: 0.9,
    steps: [{ action: 'expense.delete', data: { projectRef: projectName } }],
    confirmationMessage: 'x',
  };
  const s = svc(plan);
  const built = await s.interpret('احذف آخر مصروف', undefined, principal());
  track(built);
  assert.equal(built.kind, 'workflow_plan');
  if (built.kind !== 'workflow_plan') return;
  const exec = await s.confirm(built.sessionId, principal());
  track(exec);
  assert.equal(exec.kind, 'execution');
  const newerAfter = await prisma.projectCost.findUnique({ where: { id: newer.id } });
  const olderAfter = await prisma.projectCost.findUnique({ where: { id: older.id } });
  assert.ok(newerAfter?.deletedAt, 'newest cost soft-deleted');
  assert.equal(olderAfter?.deletedAt, null, 'older cost kept');
});

// 19) A follow-up refines the parked plan (multi-turn context).
test('a follow-up refines the parked plan', async () => {
  const projectName = `مشروع ${RUN} حوار`;
  const planA = {
    kind: 'workflow_plan',
    intent: 'draft',
    confidence: 0.9,
    steps: [{ action: 'project.create', data: { name: projectName } }],
    confirmationMessage: 'مشروع بدون مساحة. تؤكد؟',
  };
  const planB = {
    kind: 'workflow_plan',
    intent: 'refined',
    confidence: 0.95,
    steps: [{ action: 'project.create', data: { name: projectName } }],
    confirmationMessage: 'مع المساحة 250. تؤكد؟',
  };
  const { client, prompts } = scriptedLlm([planA, planB]);
  const s = new AiCommandWorkflowService(prisma, client);
  const t1 = await s.interpret('سويلي مشروع باسم حوار', undefined, principal());
  track(t1);
  assert.equal(t1.kind, 'workflow_plan');
  if (t1.kind !== 'workflow_plan') return;
  const t2 = await s.interpret('مساحته 250', t1.sessionId, principal());
  track(t2);
  assert.equal(t2.kind, 'workflow_plan');
  if (t2.kind !== 'workflow_plan') return;
  assert.equal(t2.intent, 'refined', 're-planned, not discarded');
  assert.match(prompts[1] ?? '', /REFINING/);
});
