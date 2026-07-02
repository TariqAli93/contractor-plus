// ============================================================
// Voice Phase 2B — multi-intent workflow Saga (real app + DB).
//
// Covers requirement 9:
//   • two intents in one message (create_project → add_cost), chained
//   • four intents in one message, priority-ordered, mixed server+client
//   • an intent failing mid-workflow → Saga compensation (rollback) of committed
//   • clarification recovery: ask a missing slot mid-workflow, then resume
//   • confirm-resume (every workflow confirms once, then runs)
// ============================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { signAccessToken } from '../../src/lib/jwt.js';

let app: FastifyInstance;
let ownerToken = '';
let startedAt: Date;
const sessionIds = new Set<string>();

function post(url: string, payload: unknown) {
  return app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${ownerToken}` }, payload });
}
async function interpret(transcript: string, sessionId?: string) {
  const res = await post('/api/v1/voice/interpret', { transcript, ...(sessionId ? { sessionId } : {}) });
  assert.equal(res.statusCode, 200, transcript);
  const body = res.json();
  sessionIds.add(body.sessionId);
  return body;
}
async function confirm(sessionId: string, planId: string) {
  const res = await post('/api/v1/voice/decision', { sessionId, planId, decision: 'confirm' });
  assert.equal(res.statusCode, 200);
  return res.json();
}

before(async () => {
  app = await buildApp();
  await app.ready();
  const owner = await prisma.user.findUnique({ where: { username: 'owner' }, include: { role: true } });
  assert.ok(owner);
  ownerToken = signAccessToken({ sub: owner.id, email: owner.email, role: owner.role.name });
  startedAt = new Date();
});

after(async () => {
  // Only rows created BY THIS RUN (createdAt >= startedAt) with the voice notes —
  // never touches the user's earlier sessions/projects.
  await prisma.payment.deleteMany({
    where: { createdAt: { gte: startedAt }, notes: { contains: 'عبر الأوامر الصوتية' } },
  });
  await prisma.projectCost.deleteMany({
    where: { createdAt: { gte: startedAt }, notes: { contains: 'عبر الأوامر الصوتية' } },
  });
  await prisma.project.deleteMany({
    where: { createdAt: { gte: startedAt }, notes: { contains: 'عبر الأوامر الصوتية' } },
  });
  for (const id of sessionIds) await prisma.voiceSession.deleteMany({ where: { id } });
  await app.close();
});

test('two intents: create_project → add_cost, chained onto the new project', async () => {
  const t1 = await interpret('سوي مشروع بيت مساحة 100، وأضف تكلفة 500 ألف');
  assert.equal(t1.kind, 'confirm');
  assert.ok(t1.summary.lines.length >= 2, 'consolidated confirmation lists both intents');

  const exec = await confirm(t1.sessionId, t1.planId);
  assert.equal(exec.kind, 'executed');
  const project = exec.result.createdEntities.find((e: { type: string }) => e.type === 'Project');
  const cost = exec.result.createdEntities.find((e: { type: string }) => e.type === 'ProjectCost');
  assert.ok(project, 'project created');
  assert.ok(cost, 'cost created');

  const dbCost = await prisma.projectCost.findUnique({ where: { id: cost.id } });
  assert.equal(dbCost!.projectId, project.id, 'cost is chained onto the project from step 1');
});

test('four intents, priority-ordered, server + client mixed', async () => {
  const t1 = await interpret(
    'سوي مشروع بيت مساحة 110، وأضف تكلفة 500 ألف، وأضف تكلفة مليون، وافتح المشاريع',
  );
  assert.equal(t1.kind, 'confirm');
  assert.equal(t1.summary.lines.length, 4);

  const exec = await confirm(t1.sessionId, t1.planId);
  assert.equal(exec.kind, 'executed');
  const project = exec.result.createdEntities.find((e: { type: string }) => e.type === 'Project');
  const costs = exec.result.createdEntities.filter((e: { type: string }) => e.type === 'ProjectCost');
  assert.ok(project);
  assert.equal(costs.length, 2, 'both costs created');
  assert.ok(
    exec.clientActions.some((a: { type: string; to?: string }) => a.type === 'navigate' && a.to === '/projects'),
    'navigation runs as a client action',
  );

  const count = await prisma.projectCost.count({ where: { projectId: project.id } });
  assert.equal(count, 2, 'both costs chained onto the one project');
});

test('Saga: a failing intent compensates (rolls back) the committed ones', async () => {
  // add_payment requires a project WITH a contract; a voice-created standalone
  // project has none → the payment fails → create_project must be compensated.
  const t1 = await interpret('سوي مشروع بيت مساحة 913، وأضف دفعة مليون');
  assert.equal(t1.kind, 'confirm');

  const exec = await confirm(t1.sessionId, t1.planId);
  assert.equal(exec.kind, 'rejected', 'workflow fails on the payment step');

  const project = await prisma.project.findFirst({ where: { name: { contains: '913' } } });
  assert.ok(project, 'the project row still exists');
  assert.notEqual(project!.deletedAt, null, 'but it was soft-deleted by Saga compensation');
});

test('clarification recovery: ask a missing slot mid-workflow, then resume', async () => {
  const t1 = await interpret('سوي مشروع بيت، وأضف تكلفة 750 ألف'); // no area
  assert.equal(t1.kind, 'clarify');
  assert.match(t1.question, /مساحة/);

  const t2 = await interpret('130', t1.sessionId); // bare answer resumes the workflow
  assert.equal(t2.kind, 'confirm');

  const exec = await confirm(t2.sessionId, t2.planId);
  assert.equal(exec.kind, 'executed');
  assert.ok(exec.result.createdEntities.some((e: { type: string }) => e.type === 'Project'));
  assert.ok(exec.result.createdEntities.some((e: { type: string }) => e.type === 'ProjectCost'));
});
