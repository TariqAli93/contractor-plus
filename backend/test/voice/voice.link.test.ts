// ============================================================
// Voice — link_project_to_contract (real app + DB).
//
// Requirement 7 scenarios:
//   1. link the LAST project to the LAST contract (context)
//   2. link a SPECIFIC project to a SPECIFIC contract (by reference, fresh session)
//   3. linking an already-linked project → 409 conflict
//   4. add_payment on a contract-less project → clarification (not silent fail)
//   5. add_payment AFTER linking → success
// ============================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { signAccessToken } from '../../src/lib/jwt.js';

let app: FastifyInstance;
let ownerToken = '';
const projectIds: string[] = [];
const contractIds: string[] = [];
const customerIds: string[] = [];
const sessionIds = new Set<string>();

function rawPost(url: string, payload: unknown) {
  return app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${ownerToken}` }, payload });
}
async function turn(transcript: string, sessionId?: string) {
  const res = await rawPost('/api/v1/voice/interpret', { transcript, ...(sessionId ? { sessionId } : {}) });
  assert.equal(res.statusCode, 200, `${transcript} → ${res.statusCode}`);
  const body = res.json();
  sessionIds.add(body.sessionId);
  return body;
}
async function confirm(sessionId: string, planId: string) {
  const res = await rawPost('/api/v1/voice/decision', { sessionId, planId, decision: 'confirm' });
  assert.equal(res.statusCode, 200);
  return res.json();
}
function entity(exec: { result: { createdEntities: Array<{ type: string; id: string; label: string }> } }, type: string) {
  return exec.result.createdEntities.find((e) => e.type === type);
}

async function createProject(sessionId: string | undefined, transcript: string) {
  const c = await turn(transcript, sessionId);
  assert.equal(c.kind, 'confirm', `create project: ${transcript}`);
  const exec = await confirm(c.sessionId, c.planId);
  assert.equal(exec.kind, 'executed');
  const ref = entity(exec, 'Project')!;
  projectIds.push(ref.id);
  return { sessionId: c.sessionId, projectId: ref.id };
}
async function createContract(sessionId: string, transcript: string) {
  const c = await turn(transcript, sessionId);
  assert.equal(c.kind, 'confirm', 'create contract');
  const exec = await confirm(c.sessionId, c.planId);
  assert.equal(exec.kind, 'executed');
  const contract = entity(exec, 'Contract')!;
  const customer = entity(exec, 'Customer');
  contractIds.push(contract.id);
  if (customer) customerIds.push(customer.id);
  return { contractId: contract.id, contractNumber: contract.label };
}

before(async () => {
  app = await buildApp();
  await app.ready();
  const owner = await prisma.user.findUnique({ where: { username: 'owner' }, include: { role: true } });
  assert.ok(owner);
  ownerToken = signAccessToken({ sub: owner.id, email: owner.email, role: owner.role.name });
});

after(async () => {
  await prisma.payment.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
  await prisma.contractItem.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  for (const id of sessionIds) await prisma.voiceSession.deleteMany({ where: { id } });
  await app.close();
});

test('scenarios 1/3/4/5: link last↔last, payment gating, re-link conflict', async () => {
  // setup: a standalone project + a DRAFT contract in one session
  const { sessionId } = await createProject(undefined, 'سوي مشروع بيت مساحة 100');
  const { contractId } = await createContract(
    sessionId,
    'سوي عقد باسم زبون الربط مساحة 100 واجهة 5 نزال 20 طابقين بسعر 250 ألف',
  );

  // 4) add_payment on the contract-less project → clarification, not failure
  const pay1 = await turn('أضف دفعة مليون لهذا المشروع', sessionId);
  assert.equal(pay1.kind, 'clarify');
  assert.match(pay1.question, /غير مرتبط بعقد/);

  // 1) link the last project to the last contract
  const link = await turn('اربط هذا المشروع بالعقد', sessionId);
  assert.equal(link.kind, 'confirm');
  const linkExec = await confirm(link.sessionId, link.planId);
  assert.equal(linkExec.kind, 'executed');
  const project = await prisma.project.findFirst({ where: { contractId } });
  assert.ok(project, 'project is now linked to the contract');
  assert.equal(project!.id, projectIds[0]);

  // 5) add_payment after linking → success
  const pay2 = await turn('أضف دفعة مليون لهذا المشروع', sessionId);
  assert.equal(pay2.kind, 'confirm');
  const payExec = await confirm(pay2.sessionId, pay2.planId);
  assert.equal(payExec.kind, 'executed');
  assert.ok(entity(payExec, 'Payment'), 'payment created on the now-linked project');

  // 3) re-linking the already-linked project → 409 conflict
  const reLink = await rawPost('/api/v1/voice/interpret', {
    sessionId,
    transcript: 'اربط هذا المشروع بالعقد',
  });
  assert.equal(reLink.statusCode, 409);
  assert.equal(reLink.json().code, 'PROJECT_ALREADY_LINKED');
});

test('scenario 2: link a specific project to a specific contract by reference', async () => {
  // a standalone project + a contract, then link them from a FRESH session by ref
  const { sessionId } = await createProject(undefined, 'سوي مشروع بيت مساحة 222');
  const { contractId, contractNumber } = await createContract(
    sessionId,
    'سوي عقد باسم زبون الإحالة مساحة 100 واجهة 5 نزال 20 طابقين بسعر 250 ألف',
  );

  // fresh session (no context) → must resolve both from the utterance
  const link = await turn(`اربط مشروع بيت 222 بالعقد رقم ${contractNumber}`);
  assert.equal(link.kind, 'confirm');
  const exec = await confirm(link.sessionId, link.planId);
  assert.equal(exec.kind, 'executed');

  const project = await prisma.project.findFirst({ where: { contractId } });
  assert.ok(project, 'specific project linked to the specific contract');
  assert.match(project!.name, /222/);
});
