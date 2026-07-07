import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { CostCategory } from '@prisma/client';
import { prisma } from '../../src/lib/prisma.js';
import { EstimationTemplatesService } from '../../src/modules/estimation-templates/estimation-templates.service.js';
import {
  recomputeDraft,
  computeWasteAmount,
  WASTE_TEMP_ID,
} from '../../src/modules/estimation-templates/estimation-templates.calc.js';
import { money, toMoneyString } from '../../src/lib/money.js';
import { LLMError, type LlmClient } from '../../src/lib/llm/llm-client.js';
import { RoleName } from '@contractor-plus/shared';
import type { EstimationDraftItemPayload } from '../../src/modules/estimation-templates/estimation-templates.types.js';

// Deterministic LLM stand-in: complete() returns a fixed canned output, so the
// whole generate → resolve → confirm pipeline runs offline.
function fakeLlm(json: unknown): LlmClient {
  const text = typeof json === 'string' ? json : JSON.stringify(json);
  return { name: 'openai', model: 'test', complete: async () => text };
}

// Multi-turn stand-in: canned responses in order + records each user prompt.
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

const RUN = `ESTTEST-${Date.now()}`;

const created = {
  templates: new Set<string>(),
  drafts: new Set<string>(),
};

let ownerId: string;
let viewerId: string;

before(async () => {
  const users = await prisma.user.findMany({ select: { id: true, role: { select: { name: true } } } });
  assert.ok(users.length > 0, 'expected seeded users');
  ownerId = users.find((u) => u.role.name === RoleName.OWNER)?.id ?? users[0]!.id;
  viewerId = users.find((u) => u.role.name === RoleName.VIEWER)?.id ?? ownerId;
});

after(async () => {
  // Dependency order: audit → drafts (hold resultTemplateId FK) → templates
  // (cascades items) → materials.
  await prisma.estimationAuditLog.deleteMany({
    where: { OR: [{ draftId: { in: [...created.drafts] } }, { originalCommand: { contains: RUN } }] },
  });
  await prisma.estimationTemplateDraft.deleteMany({
    where: { OR: [{ id: { in: [...created.drafts] } }, { originalCommand: { contains: RUN } }] },
  });
  await prisma.estimationTemplate.deleteMany({
    where: { OR: [{ id: { in: [...created.templates] } }, { name: { contains: RUN } }] },
  });
  await prisma.material.deleteMany({ where: { name: { contains: RUN } } });
  await prisma.$disconnect();
});

function principal(role: string = RoleName.OWNER, uid: string = ownerId) {
  return { userId: uid, role, actor: { userId: uid, ipAddress: '127.0.0.1', userAgent: 'test' } };
}

function svc(json: unknown): EstimationTemplatesService {
  return new EstimationTemplatesService(prisma, fakeLlm(json));
}

interface ItemSpec {
  description: string;
  category: CostCategory;
  materialNameGuess: string | null;
  ratioPerAreaUnit: number | null;
  unitPrice: number | null;
  unit: string | null;
}

function draftLlm(opts: {
  area?: number | null;
  waste?: number;
  confidence?: number;
  templateName?: string;
  items: ItemSpec[];
}) {
  return {
    kind: 'draft',
    intent: {
      projectType: 'structural',
      constructionType: 'residential',
      scopeOfWork: 'test scope',
      templateName: opts.templateName ?? `Tmpl ${RUN}`,
      areaValue: opts.area === undefined ? 100 : opts.area,
      areaUnit: 'm2',
    },
    wastePercentage: opts.waste ?? 0,
    confidence: opts.confidence ?? 0.8,
    items: opts.items.map((it) => ({ notes: null, ...it })),
  };
}

function clarifyLlm(question: string, missingFields: string[] = ['areaValue']) {
  return { kind: 'clarification', question, missingFields, confidence: 0.4 };
}

function trackDraft(res: unknown) {
  const r = res as { draftId?: string | null };
  if (r.draftId) created.drafts.add(r.draftId);
}

async function seedMaterial(name: string, unit: string, price: number | null) {
  const m = await prisma.material.create({ data: { name, unit, defaultPrice: price, isActive: true } });
  return m;
}

// ── 1) Clarification-needed path, then follow-up completes it ─────────────────
test('missing area → clarification, follow-up completes the draft', async () => {
  const { client, prompts } = scriptedLlm([
    clarifyLlm('ما هي المساحة؟'),
    draftLlm({ area: 120, items: [{ description: 'Labor', category: CostCategory.LABOR, materialNameGuess: null, ratioPerAreaUnit: 1, unitPrice: 20, unit: 'm2' }] }),
  ]);
  const service = new EstimationTemplatesService(prisma, client);

  const first = await service.generateDraft(`plumbing ${RUN}`, undefined, principal());
  trackDraft(first);
  assert.equal(first.kind, 'clarification');
  if (first.kind !== 'clarification') return;
  assert.equal(first.status, 'CLARIFICATION_NEEDED');
  assert.ok(first.question.length > 0);

  const dbDraft = await prisma.estimationTemplateDraft.findUnique({ where: { id: first.draftId } });
  assert.equal(dbDraft?.status, 'CLARIFICATION_NEEDED');

  const second = await service.generateDraft('120', first.draftId, principal());
  trackDraft(second);
  assert.equal(second.kind, 'draft_ready');
  if (second.kind !== 'draft_ready') return;
  // The 2nd LLM turn must have used the clarify continuation prompt.
  assert.ok(prompts[1]?.includes('clarification'));
});

// ── 2) Fully-resolved-materials path → straight to READY ─────────────────────
test('all materials matched → READY_FOR_CONFIRMATION, no pending step', async () => {
  const mat = await seedMaterial(`Steel ${RUN}`, 'kg', 1.5);
  const res = await svc(
    draftLlm({ area: 100, items: [{ description: 'Reinforcement Steel', category: CostCategory.MATERIAL, materialNameGuess: `Steel ${RUN}`, ratioPerAreaUnit: 8, unitPrice: 9, unit: 'kg' }] }),
  ).generateDraft(`structural ${RUN}`, undefined, principal());
  trackDraft(res);

  assert.equal(res.kind, 'draft_ready');
  if (res.kind !== 'draft_ready') return;
  assert.equal(res.status, 'READY_FOR_CONFIRMATION');
  const item = res.items.find((i) => i.materialNameGuess === `Steel ${RUN}`)!;
  assert.equal(item.resolutionStatus, 'MATCHED');
  assert.equal(item.materialId, mat.id);
  // Catalog price wins over the LLM guess; quantity = 8 × 100 = 800.
  assert.equal(item.unitPrice, '1.50');
  assert.equal(item.quantity, '800.000');
  assert.equal(item.totalAmount, '1200.00');
});

// ── 3) Missing material → APPROVED_CREATE stages, confirm creates it ─────────
test('missing material: approve_create stages, confirm creates + links it', async () => {
  const gen = await svc(
    draftLlm({ area: 50, items: [{ description: 'PVC Sewer Pipe', category: CostCategory.MATERIAL, materialNameGuess: `Ghost ${RUN}`, ratioPerAreaUnit: 2, unitPrice: 5, unit: 'm' }] }),
  ).generateDraft(`plumbing ${RUN}`, undefined, principal());
  trackDraft(gen);
  assert.equal(gen.kind, 'draft_ready');
  if (gen.kind !== 'draft_ready') return;
  assert.equal(gen.status, 'MATERIALS_PENDING');
  const pending = gen.items.find((i) => i.materialNameGuess === `Ghost ${RUN}`)!;
  assert.equal(pending.resolutionStatus, 'PENDING_APPROVAL');

  // Not created yet — the invariant: no catalog write before confirm.
  assert.equal(await prisma.material.count({ where: { name: `Ghost ${RUN}` } }), 0);

  const service = new EstimationTemplatesService(prisma, fakeLlm({}));
  const resolved = await service.resolveMaterialDecisions(
    gen.draftId,
    [{ tempId: pending.tempId, decision: 'approve_create', unit: 'm', defaultPrice: 5 }],
    principal(),
  );
  assert.equal(resolved.status, 'READY_FOR_CONFIRMATION');
  assert.equal(await prisma.material.count({ where: { name: `Ghost ${RUN}` } }), 0, 'still not created before confirm');

  const confirmed = await service.confirmDraft(gen.draftId, `Confirmed ${RUN}`, principal());
  assert.equal(confirmed.kind, 'confirmed');
  created.templates.add(confirmed.templateId);
  assert.equal(confirmed.createdMaterialIds.length, 1);

  const newMat = await prisma.material.findFirst({ where: { name: `Ghost ${RUN}` } });
  assert.ok(newMat, 'material created at confirm');
  const items = await prisma.estimationTemplateItem.findMany({ where: { templateId: confirmed.templateId } });
  assert.ok(items.some((it) => it.materialId === newMat!.id), 'item linked to the created material');
  // The generic AuditLog CREATE row for the material exists (reused AuditService).
  const auditRow = await prisma.auditLog.findFirst({ where: { entity: 'Material', entityId: newMat!.id, action: 'CREATE' } });
  assert.ok(auditRow, 'material creation audited');
});

// ── 4) Missing material → skip stays unresolved forever ──────────────────────
test('missing material: skip leaves materialId null through confirm', async () => {
  const gen = await svc(
    draftLlm({ area: 40, items: [{ description: 'Exotic Item', category: CostCategory.MATERIAL, materialNameGuess: `Ghost2 ${RUN}`, ratioPerAreaUnit: 1, unitPrice: 3, unit: 'pc' }] }),
  ).generateDraft(`misc ${RUN}`, undefined, principal());
  trackDraft(gen);
  if (gen.kind !== 'draft_ready') return assert.fail('expected draft');
  const pending = gen.items[0]!;

  const service = new EstimationTemplatesService(prisma, fakeLlm({}));
  const resolved = await service.resolveMaterialDecisions(gen.draftId, [{ tempId: pending.tempId, decision: 'skip' }], principal());
  assert.equal(resolved.status, 'READY_FOR_CONFIRMATION');

  const confirmed = await service.confirmDraft(gen.draftId, `Skipped ${RUN}`, principal());
  created.templates.add(confirmed.templateId);
  assert.equal(await prisma.material.count({ where: { name: `Ghost2 ${RUN}` } }), 0, 'skip never creates a material');
  const items = await prisma.estimationTemplateItem.findMany({ where: { templateId: confirmed.templateId } });
  const skipped = items.find((it) => it.description === 'Exotic Item')!;
  assert.equal(skipped.materialId, null);
});

// ── 5a) Fine-grained gate: VIEWER cannot approve_create, but can skip ─────────
test('permission: VIEWER cannot approve_create (can skip)', async () => {
  const gen = await svc(
    draftLlm({ area: 30, items: [{ description: 'Some Pipe', category: CostCategory.MATERIAL, materialNameGuess: `Ghost3 ${RUN}`, ratioPerAreaUnit: 1, unitPrice: 2, unit: 'm' }] }),
  ).generateDraft(`viewer ${RUN}`, undefined, principal(RoleName.VIEWER, viewerId));
  trackDraft(gen);
  if (gen.kind !== 'draft_ready') return assert.fail('expected draft');
  const pending = gen.items[0]!;

  const service = new EstimationTemplatesService(prisma, fakeLlm({}));
  await assert.rejects(
    () => service.resolveMaterialDecisions(gen.draftId, [{ tempId: pending.tempId, decision: 'approve_create' }], principal(RoleName.VIEWER, viewerId)),
    (err: { code?: string }) => err.code === 'INSUFFICIENT_PERMISSION',
  );
  // Skip on the same draft still works.
  const skipped = await service.resolveMaterialDecisions(gen.draftId, [{ tempId: pending.tempId, decision: 'skip' }], principal(RoleName.VIEWER, viewerId));
  assert.equal(skipped.status, 'READY_FOR_CONFIRMATION');
});

// ── 5b) Confirm gate: VIEWER lacks estimation_templates.create ───────────────
test('permission: VIEWER cannot confirm (lacks create)', async () => {
  const gen = await svc(
    draftLlm({ area: 20, items: [{ description: 'Labor', category: CostCategory.LABOR, materialNameGuess: null, ratioPerAreaUnit: 1, unitPrice: 10, unit: 'm2' }] }),
  ).generateDraft(`viewer2 ${RUN}`, undefined, principal(RoleName.VIEWER, viewerId));
  trackDraft(gen);
  if (gen.kind !== 'draft_ready') return assert.fail('expected draft');
  assert.equal(gen.status, 'READY_FOR_CONFIRMATION'); // labor-only → no pending

  const service = new EstimationTemplatesService(prisma, fakeLlm({}));
  await assert.rejects(
    () => service.confirmDraft(gen.draftId, `NoPerm ${RUN}`, principal(RoleName.VIEWER, viewerId)),
    (err: { code?: string }) => err.code === 'INSUFFICIENT_PERMISSION',
  );
});

// ── 6) Transaction rollback on a mid-confirm failure ─────────────────────────
test('confirm rolls back everything on failure; draft marked FAILED', async () => {
  const mat = await seedMaterial(`Doomed ${RUN}`, 'kg', 2);
  const gen = await svc(
    draftLlm({ area: 10, templateName: `Rollback ${RUN}`, items: [{ description: 'Doomed Steel', category: CostCategory.MATERIAL, materialNameGuess: `Doomed ${RUN}`, ratioPerAreaUnit: 1, unitPrice: 2, unit: 'kg' }] }),
  ).generateDraft(`rollback ${RUN}`, undefined, principal());
  trackDraft(gen);
  if (gen.kind !== 'draft_ready') return assert.fail('expected draft');
  assert.equal(gen.status, 'READY_FOR_CONFIRMATION');

  // Force a FK failure inside the confirm tx: the MATCHED material vanishes, so
  // inserting the item (materialId → deleted material) throws → full rollback.
  await prisma.material.delete({ where: { id: mat.id } });

  const service = new EstimationTemplatesService(prisma, fakeLlm({}));
  await assert.rejects(() => service.confirmDraft(gen.draftId, `Rollback ${RUN}`, principal()));

  assert.equal(await prisma.estimationTemplate.count({ where: { name: `Rollback ${RUN}` } }), 0, 'no template persisted');
  const draft = await prisma.estimationTemplateDraft.findUnique({ where: { id: gen.draftId } });
  assert.equal(draft?.status, 'FAILED');
  const failLog = await prisma.estimationAuditLog.findFirst({ where: { draftId: gen.draftId, eventType: 'failed' } });
  assert.ok(failLog, 'failure recorded');
  assert.ok(failLog?.failedReason);
});

// ── 7) Waste-percentage Decimal rounding (pure calc) ─────────────────────────
test('waste line rounds half-up and the grand total is drift-free', () => {
  assert.equal(toMoneyString(computeWasteAmount(money('333.33'), money(15))), '50.00'); // 49.9995 → 50.00

  const items: EstimationDraftItemPayload[] = [
    { tempId: 'a', category: CostCategory.MATERIAL, description: 'M', materialNameGuess: 'M', ratioPerAreaUnit: null, quantity: '1', unit: 'x', unitPrice: '333.33', totalAmount: '0', materialId: null, resolutionStatus: 'MATCHED', sortOrder: 0, notes: null, userEdited: true },
  ];
  const { items: out, total } = recomputeDraft(items, null, 15);
  const waste = out.find((i) => i.tempId === WASTE_TEMP_ID)!;
  assert.equal(waste.totalAmount, '50.00');
  assert.equal(total, '383.33'); // 333.33 + 50.00, no float drift
});

// ── 8) Audit content after a full confirmed cycle ────────────────────────────
test('audit: confirmed row captures command, materials, and final values', async () => {
  await seedMaterial(`Cement ${RUN}`, 'bag', 8);
  const gen = await svc(
    draftLlm({
      area: 100,
      waste: 10,
      templateName: `Audited ${RUN}`,
      items: [
        { description: 'Cement', category: CostCategory.MATERIAL, materialNameGuess: `Cement ${RUN}`, ratioPerAreaUnit: 0.4, unitPrice: 9, unit: 'bag' },
        { description: 'New Brick', category: CostCategory.MATERIAL, materialNameGuess: `Brick ${RUN}`, ratioPerAreaUnit: 10, unitPrice: 0.2, unit: 'pc' },
      ],
    }),
  ).generateDraft(`audited command ${RUN}`, undefined, principal());
  trackDraft(gen);
  if (gen.kind !== 'draft_ready') return assert.fail('expected draft');
  const brick = gen.items.find((i) => i.materialNameGuess === `Brick ${RUN}`)!;

  const service = new EstimationTemplatesService(prisma, fakeLlm({}));
  await service.resolveMaterialDecisions(gen.draftId, [{ tempId: brick.tempId, decision: 'approve_create', defaultPrice: 0.2, unit: 'pc' }], principal());
  const confirmed = await service.confirmDraft(gen.draftId, `Audited ${RUN}`, principal());
  created.templates.add(confirmed.templateId);

  const row = await prisma.estimationAuditLog.findFirst({ where: { draftId: gen.draftId, eventType: 'confirmed' } });
  assert.ok(row);
  assert.ok(row!.originalCommand.includes(RUN));
  assert.ok(row!.parsedIntent);
  const newlyCreated = row!.newlyCreatedMaterials as Array<{ name: string }>;
  assert.ok(newlyCreated.some((m) => m.name === `Brick ${RUN}`));
  const existingUsed = row!.existingMaterialsUsed as Array<{ name: string }>;
  assert.ok(existingUsed.some((m) => m.name === `Cement ${RUN}`));
  const template = await prisma.estimationTemplate.findUnique({ where: { id: confirmed.templateId } });
  const finalValues = row!.finalSavedValues as { template: { estimatedTotal: string } };
  assert.equal(finalValues.template.estimatedTotal, template!.estimatedTotal.toString());
});

// ── 9a) Cancel then confirm is refused ───────────────────────────────────────
test('cancel: a cancelled draft cannot be confirmed', async () => {
  const gen = await svc(
    draftLlm({ area: 15, items: [{ description: 'Labor', category: CostCategory.LABOR, materialNameGuess: null, ratioPerAreaUnit: 1, unitPrice: 5, unit: 'm2' }] }),
  ).generateDraft(`cancel ${RUN}`, undefined, principal());
  trackDraft(gen);
  if (gen.kind !== 'draft_ready') return assert.fail('expected draft');

  const service = new EstimationTemplatesService(prisma, fakeLlm({}));
  const cancelled = await service.cancelDraft(gen.draftId, principal());
  assert.equal(cancelled.kind, 'cancelled');
  await assert.rejects(
    () => service.confirmDraft(gen.draftId, `X ${RUN}`, principal()),
    (err: { code?: string }) => err.code === 'DRAFT_NOT_READY',
  );
});

// ── 9b) Lazy expiry on read ──────────────────────────────────────────────────
test('expiry: a stale draft flips to EXPIRED on next access', async () => {
  const gen = await svc(
    draftLlm({ area: 15, items: [{ description: 'Labor', category: CostCategory.LABOR, materialNameGuess: null, ratioPerAreaUnit: 1, unitPrice: 5, unit: 'm2' }] }),
  ).generateDraft(`expiry ${RUN}`, undefined, principal());
  trackDraft(gen);
  if (gen.kind !== 'draft_ready') return assert.fail('expected draft');

  await prisma.estimationTemplateDraft.update({ where: { id: gen.draftId }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const service = new EstimationTemplatesService(prisma, fakeLlm({}));
  await assert.rejects(
    () => service.getDraft(gen.draftId, principal()),
    (err: { code?: string }) => err.code === 'DRAFT_EXPIRED',
  );
  const draft = await prisma.estimationTemplateDraft.findUnique({ where: { id: gen.draftId } });
  assert.equal(draft?.status, 'EXPIRED');
});

// ── 10) LLM error maps to a clean rejection ──────────────────────────────────
test('LLM error surfaces as a rejected result', async () => {
  const throwing: LlmClient = {
    name: 'openai',
    model: 'test',
    complete: async () => {
      throw new LLMError('openai', 429, 'rate_limited', true);
    },
  };
  const service = new EstimationTemplatesService(prisma, throwing);
  const res = await service.generateDraft(`err ${RUN}`, undefined, principal());
  assert.equal(res.kind, 'rejected');
  if (res.kind !== 'rejected') return;
  assert.equal(res.reason, 'rate_limited');
});

// ── 11) Invalid LLM output (smuggled quantity) degrades cleanly ──────────────
test('invalid AI output (smuggled quantity) is rejected, nothing persisted', async () => {
  const bad = {
    kind: 'draft',
    intent: { projectType: 'x', constructionType: null, scopeOfWork: null, templateName: 'x', areaValue: 100, areaUnit: 'm2' },
    wastePercentage: 0,
    confidence: 0.9,
    // The strict item schema forbids `quantity` → whole parse fails.
    items: [{ description: 'Steel', category: 'MATERIAL', materialNameGuess: 'Steel', ratioPerAreaUnit: 8, unitPrice: 1, unit: 'kg', quantity: 999 }],
  };
  const before = await prisma.estimationTemplateDraft.count();
  const res = await svc(bad).generateDraft(`bad ${RUN}`, undefined, principal());
  assert.equal(res.kind, 'rejected');
  if (res.kind !== 'rejected') return;
  assert.equal(res.reason, 'invalid_ai_output');
  assert.equal(await prisma.estimationTemplateDraft.count(), before, 'no draft row persisted on invalid output');
});

// ── 12) Iterative refine (conversation memory) uses the refine prompt ────────
test('refine: a follow-up edit on an existing draft uses the refine prompt', async () => {
  const { client, prompts } = scriptedLlm([
    draftLlm({ area: 100, items: [{ description: 'Cement', category: CostCategory.MATERIAL, materialNameGuess: null, ratioPerAreaUnit: 0.4, unitPrice: 9, unit: 'bag' }] }),
    draftLlm({ area: 100, items: [{ description: 'Cement', category: CostCategory.MATERIAL, materialNameGuess: null, ratioPerAreaUnit: 0.46, unitPrice: 9, unit: 'bag' }] }),
  ]);
  const service = new EstimationTemplatesService(prisma, client);
  const gen = await service.generateDraft(`refine ${RUN}`, undefined, principal());
  trackDraft(gen);
  if (gen.kind !== 'draft_ready') return assert.fail('expected draft');

  const refined = await service.generateDraft('increase cement by 15%', gen.draftId, principal());
  trackDraft(refined);
  assert.equal(refined.kind, 'draft_ready');
  assert.ok(prompts[1]?.includes('REFINING'), 'refine prompt used on the follow-up turn');
});
