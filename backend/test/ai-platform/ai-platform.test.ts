import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../src/lib/prisma.js';
import { PlatformOrchestrator } from '../../src/modules/ai-platform/ai-platform.service.js';
import { RuleEngine } from '../../src/modules/ai-platform/rules/rule-engine.js';
import { buildRegistry, registerToolRules } from '../../src/modules/ai-platform/tools/index.js';
import { PlatformAudit } from '../../src/modules/ai-platform/audit/platform-audit.js';
import { PERMISSION_CATALOG } from '../../src/modules/rbac/rbac.catalog.js';
import { EstimationTemplatesService } from '../../src/modules/estimation-templates/estimation-templates.service.js';
import { LLMError, type LlmClient } from '../../src/lib/llm/llm-client.js';
import { logger } from '../../src/lib/logger.js';
import { RoleName } from '@contractor-plus/shared';

// A deterministic LLM stand-in: the estimation tool's generate calls complete()
// once, so a single canned estimation-draft JSON drives the whole turn.
function fakeLlm(json: unknown): LlmClient {
  const text = typeof json === 'string' ? json : JSON.stringify(json);
  return { name: 'openrouter', model: 'test', complete: async () => text };
}

const RUN = `PLATTEST-${Date.now()}`;
const created = { sessions: new Set<string>(), templates: new Set<string>() };

let ownerId: string;
let viewerId: string;

before(async () => {
  const users = await prisma.user.findMany({ select: { id: true, role: { select: { name: true } } } });
  ownerId = users.find((u) => u.role.name === RoleName.OWNER)?.id ?? users[0]!.id;
  viewerId = users.find((u) => u.role.name === RoleName.VIEWER)?.id ?? ownerId;
});

after(async () => {
  await prisma.aiExecution.deleteMany({ where: { sessionId: { in: [...created.sessions] } } });
  await prisma.aiSession.deleteMany({ where: { OR: [{ id: { in: [...created.sessions] } }, { title: { contains: RUN } }] } });
  await prisma.estimationAuditLog.deleteMany({ where: { originalCommand: { contains: RUN } } });
  await prisma.estimationTemplateDraft.deleteMany({ where: { originalCommand: { contains: RUN } } });
  await prisma.estimationTemplate.deleteMany({ where: { OR: [{ id: { in: [...created.templates] } }, { name: { contains: RUN } }] } });
  await prisma.material.deleteMany({ where: { name: { contains: RUN } } });
  await prisma.$disconnect();
});

function principal(role: string = RoleName.OWNER, uid: string = ownerId) {
  return { userId: uid, role, actor: { userId: uid, ipAddress: '127.0.0.1', userAgent: 'test' } };
}

function draftLlm(area: number, materialName: string, confidence = 0.85) {
  return {
    kind: 'draft',
    intent: { projectType: 'structural', constructionType: 'residential', scopeOfWork: 'test', templateName: `PlatTmpl ${RUN}`, areaValue: area, areaUnit: 'm2' },
    wastePercentage: 5,
    confidence,
    items: [{ description: 'Reinforcement Steel', category: 'MATERIAL', materialNameGuess: materialName, ratioPerAreaUnit: 8, unitPrice: 1.5, unit: 'kg', notes: null }],
  };
}

async function seedMaterial(name: string) {
  return prisma.material.create({ data: { name, unit: 'kg', defaultPrice: 1.5, isActive: true } });
}

// ── 1) The registry is wired and tools contribute rules ──────────────────────
test('registry registers EstimationTool and its rules', () => {
  const registry = buildRegistry();
  const tool = registry.get('estimation');
  assert.ok(tool, 'estimation tool registered');
  assert.ok(registry.getAction('estimation.confirm'), 'estimation.confirm resolvable');
  const engine = new RuleEngine();
  registerToolRules(engine, registry);
  assert.ok(engine.has('estimation.recompute'), 'estimation.recompute registered');
  assert.ok(engine.has('estimation.wasteAmount'), 'estimation.wasteAmount registered');
});

// ── 1b) The RBAC catalog CONSUMES every tool-contributed permission (no manual
//       duplication can drift out of sync) and has no duplicate keys. ──────────
test('RBAC catalog includes every tool-contributed permission', () => {
  const catalogKeys = PERMISSION_CATALOG.map((p) => p.key);
  const keySet = new Set(catalogKeys);
  assert.equal(keySet.size, catalogKeys.length, 'catalog has no duplicate permission keys');

  const toolPerms = buildRegistry().contributedPermissions();
  assert.ok(toolPerms.length > 0, 'tools contribute permissions');
  for (const perm of toolPerms) {
    assert.ok(keySet.has(perm.key), `catalog must include tool permission "${perm.key}"`);
  }
});

// ── 2) Full pipeline: open → message → preview(READY) → confirm → execution ──
test('open → message → confirm creates a template through the platform', async () => {
  const mat = await seedMaterial(`Steel ${RUN}`);
  const orch = new PlatformOrchestrator(prisma, fakeLlm(draftLlm(100, `Steel ${RUN}`)));

  const session = await orch.openSession(principal(), `PLAT ${RUN}`);
  created.sessions.add(session.id);

  const msg = await orch.message(session.id, `structural estimate ${RUN}`, principal());
  assert.equal(msg.kind, 'preview');
  if (msg.kind !== 'preview') return;
  assert.equal(msg.renderKind, 'estimation');
  assert.equal(msg.requiresConfirmation, true, 'matched material → READY → confirmable');

  // Session parked the plan (status AWAITING_CONFIRMATION) durably.
  const parked = await prisma.aiSession.findUnique({ where: { id: session.id } });
  assert.equal(parked?.status, 'AWAITING_CONFIRMATION');
  assert.ok(parked?.pendingPlan, 'plan parked on the session row');

  const confirmed = await orch.confirm(session.id, principal());
  assert.equal(confirmed.kind, 'execution');
  if (confirmed.kind !== 'execution') return;
  const templateId = confirmed.createdEntityIds.template;
  assert.ok(templateId, 'template created');
  created.templates.add(templateId);

  const template = await prisma.estimationTemplate.findUnique({ where: { id: templateId }, include: { items: true } });
  assert.ok(template, 'template row persisted');
  assert.ok(template!.items.some((it) => it.materialId === mat.id), 'item linked to the matched material');

  const done = await prisma.aiSession.findUnique({ where: { id: session.id } });
  assert.equal(done?.status, 'COMPLETED');

  const exec = await prisma.aiExecution.findFirst({ where: { sessionId: session.id, transactionResult: 'executed' } });
  assert.ok(exec, 'unified AiExecution audit row written');
});

// ── 2b) The rule engine is LIVE: the preview's material-waste figure is produced
//       by RuleEngine.run (deterministic money math, not the AI). ─────────────
test('the preview surfaces a rule-engine-computed material waste amount', async () => {
  await seedMaterial(`Steel ${RUN} rule`);
  const orch = new PlatformOrchestrator(prisma, fakeLlm(draftLlm(100, `Steel ${RUN} rule`)));
  const session = await orch.openSession(principal(), `PLAT ${RUN} rule`);
  created.sessions.add(session.id);
  const msg = await orch.message(session.id, `rule engine ${RUN}`, principal());
  assert.equal(msg.kind, 'preview');
  if (msg.kind !== 'preview') return;
  // qty = 8 × 100 = 800; material total = 800 × 1.5 = 1200; waste = 5% → 60.00.
  const payload = msg.payload as { wasteAmount?: string };
  assert.equal(payload.wasteAmount, '60.00', 'waste computed by the rule engine');
});

// ── 2c) The confidence engine GATES the live message path: a low-confidence
//       mutating preview becomes a clarification, and no plan is parked. ───────
test('a low-confidence preview is gated to a clarification', async () => {
  await seedMaterial(`Steel ${RUN} lowconf`);
  const orch = new PlatformOrchestrator(prisma, fakeLlm(draftLlm(100, `Steel ${RUN} lowconf`, 0.1)));
  const session = await orch.openSession(principal(), `PLAT ${RUN} lowconf`);
  created.sessions.add(session.id);
  const msg = await orch.message(session.id, `low confidence ${RUN}`, principal());
  assert.equal(msg.kind, 'clarification', 'low confidence → gated to clarification');

  // Nothing was parked for confirmation.
  const row = await prisma.aiSession.findUnique({ where: { id: session.id } });
  assert.notEqual(row?.status, 'AWAITING_CONFIRMATION', 'no plan parked when gated');
});

// ── 3) DURABILITY: a parked plan survives into a FRESH orchestrator instance ─
test('durability: confirm works on a fresh orchestrator (session survives restart)', async () => {
  await seedMaterial(`Rebar ${RUN}`);
  const orch1 = new PlatformOrchestrator(prisma, fakeLlm(draftLlm(80, `Rebar ${RUN}`)));
  const session = await orch1.openSession(principal(), `PLAT ${RUN} dur`);
  created.sessions.add(session.id);
  const msg = await orch1.message(session.id, `structural durable ${RUN}`, principal());
  assert.equal(msg.kind, 'preview');

  // Simulate a server restart: a brand-new orchestrator with NO shared memory.
  const orch2 = new PlatformOrchestrator(prisma, fakeLlm({}));
  const confirmed = await orch2.confirm(session.id, principal());
  assert.equal(confirmed.kind, 'execution', 'the durable parked plan executed on a fresh instance');
  if (confirmed.kind === 'execution' && confirmed.createdEntityIds.template) {
    created.templates.add(confirmed.createdEntityIds.template);
  }
});

// ── 4) Permission gate: VIEWER cannot use the estimation NL entry ────────────
test('permission: VIEWER (no ai_generate) is rejected at the tool entry', async () => {
  const orch = new PlatformOrchestrator(prisma, fakeLlm(draftLlm(50, `Ghost ${RUN}`)));
  const session = await orch.openSession(principal(RoleName.VIEWER, viewerId), `PLAT ${RUN} viewer`);
  created.sessions.add(session.id);
  const res = await orch.message(session.id, `try estimate ${RUN}`, principal(RoleName.VIEWER, viewerId));
  assert.equal(res.kind, 'rejected');
  if (res.kind !== 'rejected') return;
  assert.equal(res.reason, 'insufficient_permission');
});

// ── 5) Cancel: a session with a draft cancels cleanly ────────────────────────
test('cancel: a session is cancelled and its draft cleaned up', async () => {
  await seedMaterial(`Cancel ${RUN}`);
  const orch = new PlatformOrchestrator(prisma, fakeLlm(draftLlm(30, `Cancel ${RUN}`)));
  const session = await orch.openSession(principal(), `PLAT ${RUN} cancel`);
  created.sessions.add(session.id);
  await orch.message(session.id, `cancel me ${RUN}`, principal());
  const res = await orch.cancel(session.id, principal());
  assert.equal(res.kind, 'cancelled');
  const row = await prisma.aiSession.findUnique({ where: { id: session.id } });
  assert.equal(row?.status, 'CANCELLED');
});

// ── 5b) An LLM provider failure surfaces as a CODED rejected result (the code,
//       not a raw English message — the frontend localizes it). ───────────────
test('an LLM provider failure surfaces as a coded rejected result', async () => {
  const throwing: LlmClient = {
    name: 'openrouter',
    model: 'test',
    complete: async () => {
      throw new LLMError('openrouter', 429, 'rate_limited', true);
    },
  };
  const orch = new PlatformOrchestrator(prisma, throwing);
  const session = await orch.openSession(principal(), `PLAT ${RUN} llmerr`);
  created.sessions.add(session.id);
  const msg = await orch.message(session.id, `boom ${RUN}`, principal());
  assert.equal(msg.kind, 'rejected');
  if (msg.kind !== 'rejected') return;
  assert.equal(msg.reason, 'rate_limited', 'coded LLM reason, not a raw English exception');
});

// ── 5c) An UNCAUGHT interpretation error is coded (not leaked) AND audited. ───
test('an uncaught interpretation error is coded and audited', async () => {
  const orch = new PlatformOrchestrator(prisma, fakeLlm(draftLlm(50, `Steel ${RUN} throw`)));
  const session = await orch.openSession(principal(), `PLAT ${RUN} throw`);
  created.sessions.add(session.id);

  const original = EstimationTemplatesService.prototype.generateDraft;
  EstimationTemplatesService.prototype.generateDraft = async () => {
    throw new Error('unexpected boom');
  };
  let msg;
  try {
    msg = await orch.message(session.id, `throw ${RUN}`, principal());
  } finally {
    EstimationTemplatesService.prototype.generateDraft = original;
  }
  assert.equal(msg.kind, 'rejected');
  if (msg.kind !== 'rejected') return;
  assert.equal(msg.reason, 'tool_error', 'coded, not a raw exception surfaced to the user');

  const audit = await prisma.aiExecution.findFirst({ where: { sessionId: session.id, transactionResult: 'failed' } });
  assert.ok(audit, 'the intake failure was audited');
});

// ── 6) Confirm with no parked plan is a clean rejection ──────────────────────
test('confirm without a parked plan is rejected', async () => {
  const orch = new PlatformOrchestrator(prisma, fakeLlm({}));
  const session = await orch.openSession(principal(), `PLAT ${RUN} noplan`);
  created.sessions.add(session.id);
  const res = await orch.confirm(session.id, principal());
  assert.equal(res.kind, 'rejected');
  if (res.kind === 'rejected') assert.equal(res.reason, 'no_pending_plan');
});

// ── 7) A failed executed-audit write must not fail the committed operation, but
//      must be logged (never silently swallowed). ─────────────────────────────
test('a failed executed-audit write keeps the operation but is logged', async () => {
  await seedMaterial(`AuditFail ${RUN}`);
  const orch = new PlatformOrchestrator(prisma, fakeLlm(draftLlm(60, `AuditFail ${RUN}`)));
  const session = await orch.openSession(principal(), `PLAT ${RUN} auditfail`);
  created.sessions.add(session.id);
  const msg = await orch.message(session.id, `audit fail ${RUN}`, principal());
  assert.equal(msg.kind, 'preview');

  // Make the post-execution audit write throw, and capture that it is logged.
  const originalRecord = PlatformAudit.prototype.record;
  const spied = logger as unknown as { error: (...a: unknown[]) => void };
  const originalError = spied.error;
  const errorCalls: unknown[][] = [];
  PlatformAudit.prototype.record = async () => {
    throw new Error('audit DB down');
  };
  spied.error = (...args: unknown[]) => {
    errorCalls.push(args);
  };
  let confirmed;
  try {
    confirmed = await orch.confirm(session.id, principal());
  } finally {
    PlatformAudit.prototype.record = originalRecord;
    spied.error = originalError;
  }

  assert.equal(confirmed.kind, 'execution', 'operation succeeds despite the audit failure');
  if (confirmed.kind === 'execution' && confirmed.createdEntityIds.template) {
    created.templates.add(confirmed.createdEntityIds.template);
  }
  assert.ok(
    errorCalls.some((a) => typeof a[1] === 'string' && /audit/i.test(a[1] as string)),
    'the audit failure was logged',
  );
});
