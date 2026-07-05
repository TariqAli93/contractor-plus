// ============================================================
// Voice — HTTP end-to-end integration tests (real Fastify + real DB).
//
// Boots the actual app with buildApp(), mints real JWTs for the seeded demo
// users, and drives the /voice endpoints with app.inject(). Covers the live
// review scenarios:
//   1. open pages by voice (navigate)
//   2. create a simple project (confirm → execute)
//   3. an incomplete command asks for clarification
//   4. a command that requires confirmation
//   5. a user without voice.use is blocked (route guard)
//   6. VoiceSession + VoiceCommandLog are persisted
//   +  per-action RBAC: a VIEWER cannot create_project
//
// Requires a reachable DB seeded via `prisma db seed`. Cleans up everything it
// creates in `after`.
// ============================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { signAccessToken } from '../../src/lib/jwt.js';

let app: FastifyInstance;
const tokens: Record<string, string> = {};
const createdProjectIds: string[] = [];
const createdSessionIds = new Set<string>();
let noAccessUserId = '';
let noAccessRoleId = '';

async function tokenFor(username: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { username },
    include: { role: true },
  });
  assert.ok(user, `seeded user "${username}" must exist (run prisma db seed)`);
  return signAccessToken({ sub: user.id, email: user.email, role: user.role.name });
}

function authPost(token: string, url: string, payload: unknown) {
  return app.inject({
    method: 'POST',
    url,
    headers: { authorization: `Bearer ${token}` },
    payload,
  });
}

before(async () => {
  app = await buildApp();
  await app.ready();

  tokens.owner = await tokenFor('owner');
  tokens.viewer = await tokenFor('viewer');

  // A throwaway role+user WITHOUT voice.use for the route-guard scenario.
  await prisma.user.deleteMany({ where: { username: 'voice_noaccess_test' } });
  await prisma.role.deleteMany({ where: { name: 'VOICE_NOACCESS_TEST' } });
  const role = await prisma.role.create({
    data: { name: 'VOICE_NOACCESS_TEST', isSystem: false, isProtected: false },
  });
  noAccessRoleId = role.id;
  const user = await prisma.user.create({
    data: {
      username: 'voice_noaccess_test',
      passwordHash: 'x',
      fullName: 'No Access',
      roleId: role.id,
    },
  });
  noAccessUserId = user.id;
  tokens.noaccess = signAccessToken({ sub: user.id, email: null, role: role.name });
});

after(async () => {
  for (const id of createdProjectIds) {
    await prisma.project.deleteMany({ where: { id } });
  }
  for (const id of createdSessionIds) {
    await prisma.voiceSession.deleteMany({ where: { id } }); // cascades command logs
  }
  if (noAccessUserId) await prisma.user.deleteMany({ where: { id: noAccessUserId } });
  if (noAccessRoleId) await prisma.role.deleteMany({ where: { id: noAccessRoleId } });
  await app.close();
});

// ---------- 5. route guard: no voice.use → 403 ----------
test('scenario 5: a user without voice.use is blocked at the route', async () => {
  const res = await authPost(tokens.noaccess, '/api/v1/voice/interpret', {
    transcript: 'افتح المشاريع',
  });
  assert.equal(res.statusCode, 403);
});

// ---------- 1. open pages by voice ----------
test('scenario 1: navigate by voice', async () => {
  const res = await authPost(tokens.owner, '/api/v1/voice/interpret', {
    transcript: 'افتح المشاريع',
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  createdSessionIds.add(body.sessionId);
  assert.equal(body.kind, 'executed');
  assert.deepEqual(body.clientActions, [{ type: 'navigate', to: '/projects' }]);
});

// ---------- 3. incomplete command → clarify ----------
test('scenario 3: incomplete command asks for clarification', async () => {
  const res = await authPost(tokens.owner, '/api/v1/voice/interpret', {
    transcript: 'سوي مشروع بيت',
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  createdSessionIds.add(body.sessionId);
  assert.equal(body.kind, 'clarify');
  assert.deepEqual(body.missingSlots, ['area']);
  assert.match(body.question, /مساحة/);
});

// ---------- 2 + 4 + 6: confirm → execute → persisted ----------
test('scenarios 2/4/6: create a project (needs confirmation) and persist the log', async () => {
  // 4: a mutating command must return a confirmation, not execute immediately.
  const interp = await authPost(tokens.owner, '/api/v1/voice/interpret', {
    transcript: 'سوي مشروع بيت مساحة 120 واجهة 6 ونزال 25',
  });
  assert.equal(interp.statusCode, 200);
  const confirm = interp.json();
  createdSessionIds.add(confirm.sessionId);
  assert.equal(confirm.kind, 'confirm');
  assert.ok(confirm.planId, 'a planId must be issued');
  assert.deepEqual(confirm.requiredPermissions, ['projects.create']);
  assert.ok(
    confirm.summary.lines.some((l: { value: string }) => l.value.includes('120')),
    'summary should reflect the spoken area',
  );

  // 2: confirming executes and creates the project.
  const decide = await authPost(tokens.owner, '/api/v1/voice/decision', {
    sessionId: confirm.sessionId,
    planId: confirm.planId,
    decision: 'confirm',
  });
  assert.equal(decide.statusCode, 200);
  const executed = decide.json();
  assert.equal(executed.kind, 'executed');
  assert.equal(executed.result.createdEntities.length, 1);
  const ref = executed.result.createdEntities[0];
  assert.equal(ref.type, 'Project');
  createdProjectIds.push(ref.id);

  // 6: the Project actually exists, and the session/log were recorded.
  const project = await prisma.project.findUnique({ where: { id: ref.id } });
  assert.ok(project, 'project row must be persisted');
  assert.equal(project!.status, 'PLANNED');

  const session = await prisma.voiceSession.findUnique({ where: { id: confirm.sessionId } });
  assert.ok(session, 'voice session must be persisted');

  const logs = await prisma.voiceCommandLog.findMany({
    where: { sessionId: confirm.sessionId },
    orderBy: { createdAt: 'asc' },
  });
  const statuses = logs.map((l) => l.status);
  assert.ok(statuses.includes('AWAITING_CONFIRMATION'), 'confirmation turn logged');
  assert.ok(statuses.includes('EXECUTED'), 'execution turn logged');
  const executedLog = logs.find((l) => l.status === 'EXECUTED');
  assert.equal(executedLog!.intent, 'create_project');
});

// ---------- per-action RBAC: VIEWER cannot create_project ----------
test('per-action RBAC: a VIEWER (has voice.use) is denied create_project', async () => {
  const res = await authPost(tokens.viewer, '/api/v1/voice/interpret', {
    transcript: 'سوي مشروع بيت مساحة 90',
  });
  assert.equal(res.statusCode, 200); // route allows entry…
  const body = res.json();
  createdSessionIds.add(body.sessionId);
  assert.equal(body.kind, 'rejected'); // …but the action is denied
  assert.equal(body.reason, 'permission_denied');
  assert.deepEqual(body.missingPermissions, ['projects.create']);
});
