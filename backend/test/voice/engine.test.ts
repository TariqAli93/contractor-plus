import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoleName, VoiceIntent } from '@contractor-plus/shared';
import { RuleBasedNluProvider } from '../../src/modules/voice/nlu/rule-based.provider.js';
import { ContextManager } from '../../src/modules/voice/engine/context-manager.js';
import { WorkflowEngine } from '../../src/modules/voice/engine/workflow-engine.js';
import { ConfirmationEngine } from '../../src/modules/voice/engine/confirmation-engine.js';
import { PermissionEngine } from '../../src/modules/voice/engine/permission-engine.js';
import { Executor } from '../../src/modules/voice/engine/executor.js';
import { IntentRegistry } from '../../src/modules/voice/engine/intent-registry.js';
import { CreateProjectHandler } from '../../src/modules/voice/engine/intents/create-project.handler.js';
import { NavigateHandler } from '../../src/modules/voice/engine/intents/navigate.handler.js';
import type { VoicePrincipal } from '../../src/modules/voice/engine/voice.types.js';

// ---- fakes (no DB) ----
const fakeRepo = {
  create: async (data: { name: string; notes?: string | null }) => ({
    id: 'proj-1',
    name: data.name,
    notes: data.notes ?? null,
    status: 'PLANNED',
  }),
} as unknown as import('../../src/modules/projects/projects.repository.js').ProjectsRepository;

const fakeAudit = { log: async () => {} } as unknown as import('../../src/modules/audit/audit.service.js').AuditService;
const fakePrisma = {
  $transaction: async (fn: (tx: unknown) => unknown) => fn({}),
} as unknown as import('@prisma/client').PrismaClient;

const registry = new IntentRegistry()
  .register(new CreateProjectHandler({ projects: fakeRepo }))
  .register(new NavigateHandler());

const nlu = new RuleBasedNluProvider();
const context = new ContextManager();
const workflow = new WorkflowEngine();
const confirmation = new ConfirmationEngine();
const permission = new PermissionEngine();
const executor = new Executor(fakePrisma, fakeAudit);
const actor = { userId: 'u1', role: RoleName.OWNER, ipAddress: '127.0.0.1', userAgent: 'test' };

const owner: VoicePrincipal = { userId: 'u1', role: RoleName.OWNER, permissions: new Set() };
const viewer: VoicePrincipal = { userId: 'u2', role: RoleName.VIEWER, permissions: new Set(['voice.use']) };

test('workflow asks a clarify question when a required slot is missing', async () => {
  const r = await nlu.interpret('سوي مشروع بيت', { locale: 'ar' });
  const handler = registry.get(r.intent)!;
  const bag = context.resolve(r.entityBag, {});
  const outcome = await workflow.buildPlan(handler, bag, {}, actor);
  assert.equal(outcome.kind, 'clarify');
  if (outcome.kind === 'clarify') {
    assert.deepEqual(outcome.missingSlots, ['area']);
    assert.match(outcome.question, /مساحة/);
  }
});

test('builds a mutating, confirmable plan once slots are satisfied', async () => {
  const r = await nlu.interpret('سوي مشروع بيت مساحة 100', { locale: 'ar' });
  const handler = registry.get(r.intent)!;
  const bag = context.resolve(r.entityBag, {});
  const outcome = await workflow.buildPlan(handler, bag, {}, actor);
  assert.equal(outcome.kind, 'plan');
  if (outcome.kind !== 'plan') return;
  assert.equal(outcome.plan.mutates, true);
  assert.equal(confirmation.requiresConfirmation(outcome.plan), true);
  assert.deepEqual(outcome.plan.requiredPermissions, ['projects.create']);
  assert.ok(outcome.plan.summary.lines.some((l) => l.value.includes('100')));
});

test('permission engine: OWNER passes, VIEWER without projects.create is blocked', async () => {
  const r = await nlu.interpret('سوي مشروع بيت مساحة 100', { locale: 'ar' });
  const handler = registry.get(r.intent)!;
  const bag = context.resolve(r.entityBag, {});
  const outcome = await workflow.buildPlan(handler, bag, {}, actor);
  assert.equal(outcome.kind, 'plan');
  if (outcome.kind !== 'plan') return;

  assert.deepEqual(permission.evaluate(outcome.plan, owner), { allowed: true, missing: [] });
  const verdict = permission.evaluate(outcome.plan, viewer);
  assert.equal(verdict.allowed, false);
  assert.deepEqual(verdict.missing, ['projects.create']);
});

test('executor runs the server plan transactionally and returns created entities', async () => {
  const r = await nlu.interpret('سوي مشروع بيت مساحة 100', { locale: 'ar' });
  const handler = registry.get(r.intent)!;
  const bag = context.resolve(r.entityBag, {});
  const outcome = await workflow.buildPlan(handler, bag, {}, actor);
  assert.equal(outcome.kind, 'plan');
  if (outcome.kind !== 'plan') return;

  const result = await executor.execute(outcome.plan, actor);
  assert.equal(result.createdEntities.length, 1);
  assert.equal(result.createdEntities[0].type, 'Project');
  assert.equal(result.createdEntities[0].id, 'proj-1');
  assert.equal(result.outputs.projectId, 'proj-1');
});

test('navigate is a non-mutating client plan that needs no confirmation', async () => {
  const r = await nlu.interpret('افتح المشاريع', { locale: 'ar' });
  const handler = registry.get(r.intent)!;
  const bag = context.resolve(r.entityBag, {});
  const outcome = await workflow.buildPlan(handler, bag, {}, actor);
  assert.equal(outcome.kind, 'plan');
  if (outcome.kind !== 'plan') return;

  assert.equal(outcome.plan.mutates, false);
  assert.equal(confirmation.requiresConfirmation(outcome.plan), false);
  const result = await executor.execute(outcome.plan, actor);
  assert.deepEqual(result.clientActions, [{ type: 'navigate', to: '/projects' }]);
});

test('context manager resolves "اسمه" to the last customer', () => {
  const merged = context.resolve(
    { entityRef: 'last_customer' },
    { lastCustomerName: 'أحمد' },
  );
  assert.equal(merged.customerName, 'أحمد');
});
