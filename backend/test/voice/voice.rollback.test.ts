// ============================================================
// Voice — transaction rollback integration test (scenario 7, real DB).
//
// Proves المرحلة العاشرة: when a later step of a Workflow throws, the WHOLE turn
// rolls back. Uses the REAL Executor and a REAL Prisma transaction with a
// two-step plan: step 1 creates a Project (and writes its audit row), step 2
// throws. After the failure, the Project from step 1 must NOT exist.
// ============================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceIntent } from '@contractor-plus/shared';
import { prisma } from '../../src/lib/prisma.js';
import { AuditService } from '../../src/modules/audit/audit.service.js';
import { Executor } from '../../src/modules/voice/engine/executor.js';
import type { Plan } from '../../src/modules/voice/engine/voice.types.js';

const MARKER = '__VOICE_ROLLBACK_TEST__';
let ownerId = '';

before(async () => {
  const owner = await prisma.user.findUnique({ where: { username: 'owner' } });
  assert.ok(owner, 'seeded "owner" user required');
  ownerId = owner.id;
  await prisma.project.deleteMany({ where: { name: MARKER } });
  await prisma.auditLog.deleteMany({ where: { userAgent: 'rollback-test' } });
});

after(async () => {
  await prisma.project.deleteMany({ where: { name: MARKER } });
  await prisma.auditLog.deleteMany({ where: { userAgent: 'rollback-test' } });
});

test('scenario 7: a failing later step rolls back the whole workflow', async () => {
  const executor = new Executor(prisma, new AuditService(prisma));
  const actor = { userId: ownerId, ipAddress: '127.0.0.1', userAgent: 'rollback-test' };

  const plan: Plan = {
    intent: VoiceIntent.UPDATE_PROJECT,
    side: 'server',
    mutates: true,
    requiredPermissions: [],
    summary: { title: 'rollback test', mutates: true, lines: [] },
    steps: [
      {
        description: 'create project (should be rolled back)',
        requiredPermissions: [],
        execute: async (ctx) => {
          const created = await ctx.tx.project.create({
            data: { name: MARKER, status: 'PLANNED' },
          });
          await ctx.audit.log(
            ctx.actor,
            { action: 'CREATE', entity: 'Project', entityId: created.id, newValues: {} },
            ctx.tx,
          );
          return {
            createdEntities: [{ type: 'Project', id: created.id, label: MARKER }],
            outputs: { projectId: created.id },
          };
        },
      },
      {
        description: 'fail on purpose',
        requiredPermissions: [],
        execute: async () => {
          throw new Error('intentional failure in step 2');
        },
      },
    ],
  };

  // The executor must surface the failure…
  await assert.rejects(() => executor.execute(plan, actor), /intentional failure/);

  // …and step 1's Project must have been rolled back (atomicity).
  const leftover = await prisma.project.findFirst({ where: { name: MARKER } });
  assert.equal(leftover, null, 'project from step 1 must not survive the rollback');

  // The audit row written inside the same tx must be gone too.
  const auditRows = await prisma.auditLog.findMany({
    where: { entity: 'Project', userAgent: 'rollback-test' },
  });
  assert.equal(auditRows.length, 0, 'audit row must roll back with the domain mutation');
});
