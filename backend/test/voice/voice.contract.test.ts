// ============================================================
// Voice Phase 2A — create_contract + multi-turn slot filling (real app + DB).
//
// Verifies the financial vertical end-to-end:
//   • multi-turn clarification: a bare "250 ألف" answers "ما سعر المتر؟"
//   • Template Matching selects a template from the spoken dimensions
//   • Material Intelligence: confirming creates the contract AND populates its
//     items via generateEstimate (ContractItem rows > 0), atomically
//   • find-or-create customer
//   • create_project multi-turn resumption ("مساحته 200" answers the area ask)
// ============================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { signAccessToken } from '../../src/lib/jwt.js';

let app: FastifyInstance;
let ownerToken = '';
const CUSTOMER_NAME = 'سعد فحص الصوت';
const createdContractIds: string[] = [];
const createdCustomerIds: string[] = [];
const createdProjectIds: string[] = [];
const sessionIds = new Set<string>();

function post(url: string, payload: unknown) {
  return app.inject({
    method: 'POST',
    url,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload,
  });
}

before(async () => {
  app = await buildApp();
  await app.ready();
  const owner = await prisma.user.findUnique({ where: { username: 'owner' }, include: { role: true } });
  assert.ok(owner, 'seeded owner required');
  ownerToken = signAccessToken({ sub: owner.id, email: owner.email, role: owner.role.name });
  // Start clean in case a prior aborted run left the test customer behind.
  await prisma.customer.deleteMany({ where: { name: CUSTOMER_NAME } });
});

after(async () => {
  for (const id of createdContractIds) {
    await prisma.contractItem.deleteMany({ where: { contractId: id } });
    await prisma.contract.deleteMany({ where: { id } });
  }
  await prisma.customer.deleteMany({ where: { name: CUSTOMER_NAME } });
  for (const id of createdProjectIds) await prisma.project.deleteMany({ where: { id } });
  for (const id of sessionIds) await prisma.voiceSession.deleteMany({ where: { id } });
  await app.close();
});

test('create_contract: multi-turn meterPrice clarification → confirm → atomic create + estimate', async () => {
  // Turn 1 — everything but the meter price.
  const t1 = await post('/api/v1/voice/interpret', {
    transcript: `سوي عقد باسم ${CUSTOMER_NAME} مساحة 100 واجهة 5 نزال 20 طابقين`,
  });
  assert.equal(t1.statusCode, 200);
  const r1 = t1.json();
  sessionIds.add(r1.sessionId);
  assert.equal(r1.kind, 'clarify');
  assert.deepEqual(r1.missingSlots, ['meterPrice']);
  assert.match(r1.question, /سعر/);

  // Turn 2 — a BARE answer ("250 ألف" = 250000) must fill the pending slot.
  const t2 = await post('/api/v1/voice/interpret', {
    sessionId: r1.sessionId,
    transcript: '250 ألف',
  });
  assert.equal(t2.statusCode, 200);
  const r2 = t2.json();
  assert.equal(r2.kind, 'confirm');
  assert.ok(r2.planId);
  // Template was matched + suggested price surfaced for comparison.
  const labels = r2.summary.lines.map((l: { label: string }) => l.label);
  assert.ok(labels.includes('القالب'));
  assert.ok(labels.some((l: string) => l.includes('المقترح')));

  // Turn 3 — confirm → execute.
  const t3 = await post('/api/v1/voice/decision', {
    sessionId: r2.sessionId,
    planId: r2.planId,
    decision: 'confirm',
  });
  assert.equal(t3.statusCode, 200);
  const r3 = t3.json();
  assert.equal(r3.kind, 'executed');
  const contractRef = r3.result.createdEntities.find((e: { type: string }) => e.type === 'Contract');
  const customerRef = r3.result.createdEntities.find((e: { type: string }) => e.type === 'Customer');
  assert.ok(contractRef, 'a Contract must be created');
  assert.ok(customerRef, 'a new Customer must be created');
  createdContractIds.push(contractRef.id);
  createdCustomerIds.push(customerRef.id);

  // The contract exists as DRAFT and its material list was populated.
  const contract = await prisma.contract.findUnique({ where: { id: contractRef.id } });
  assert.ok(contract);
  assert.equal(contract!.status, 'DRAFT');
  assert.ok(contract!.templateId, 'a template was matched and linked');

  const itemCount = await prisma.contractItem.count({ where: { contractId: contractRef.id } });
  assert.ok(itemCount > 0, 'generateEstimate populated the contract items (Material Intelligence)');

  const customer = await prisma.customer.findUnique({ where: { id: customerRef.id } });
  assert.equal(customer!.name, CUSTOMER_NAME);
});

test('create_project: multi-turn resumption — "مساحته 200" answers the area question', async () => {
  const t1 = await post('/api/v1/voice/interpret', { transcript: 'سوي مشروع بيت' });
  const r1 = t1.json();
  sessionIds.add(r1.sessionId);
  assert.equal(r1.kind, 'clarify');
  assert.deepEqual(r1.missingSlots, ['area']);

  const t2 = await post('/api/v1/voice/interpret', {
    sessionId: r1.sessionId,
    transcript: 'مساحته 200',
  });
  const r2 = t2.json();
  assert.equal(r2.kind, 'confirm');
  assert.ok(r2.summary.lines.some((l: { value: string }) => l.value.includes('200')));

  const t3 = await post('/api/v1/voice/decision', {
    sessionId: r2.sessionId,
    planId: r2.planId,
    decision: 'confirm',
  });
  const r3 = t3.json();
  assert.equal(r3.kind, 'executed');
  const ref = r3.result.createdEntities[0];
  assert.equal(ref.type, 'Project');
  createdProjectIds.push(ref.id);

  const project = await prisma.project.findUnique({ where: { id: ref.id } });
  assert.ok(project);
});
