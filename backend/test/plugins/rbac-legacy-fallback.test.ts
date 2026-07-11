import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { pino } from 'pino';
import { RoleName } from '@contractor-plus/shared';
import type { PrismaClient } from '@prisma/client';
import rbacPlugin from '../../src/plugins/rbac.plugin.js';

/**
 * Regression coverage for F-SEC-1 / B1 (SECURITY.md, BACKEND.md §12.1).
 *
 * The legacy role fallback is NOT removed in Phase 0 (its equivalent permission
 * grants are not migrated yet). These tests pin its exact current behaviour so
 * the Phase 2 removal is safe, and prove that any grant flowing through the
 * fallback AFTER a failed permission check now emits the structured warning that
 * makes the live defect auditable instead of silent.
 */

const rolePermissions: Record<string, string[]> = {
  ACCOUNTANT: ['payments.read'], // deliberately LACKS contracts.approve
  ADMIN: ['contracts.approve'], // HAS it, so it passes on the permission path
};

const fakePrisma = {
  rolePermission: {
    findMany: async ({ where }: { where: { role: { name: string } } }) =>
      (rolePermissions[where.role.name] ?? []).map((key) => ({ permission: { key } })),
  },
} as unknown as PrismaClient;

function setUser(
  request: { headers: Record<string, unknown>; user?: unknown },
  _reply: unknown,
  done: () => void,
): void {
  const id = request.headers['x-uid'];
  const role = request.headers['x-role'];
  if (typeof id === 'string' && typeof role === 'string') {
    request.user = { id, email: null, role };
  }
  done();
}

async function buildApp(): Promise<{ app: FastifyInstance; lines: Array<Record<string, unknown>> }> {
  const lines: Array<Record<string, unknown>> = [];
  const stream = {
    write(chunk: string): void {
      for (const line of chunk.split('\n')) {
        if (line.trim()) lines.push(JSON.parse(line) as Record<string, unknown>);
      }
    },
  };
  const app = Fastify({ logger: pino({ level: 'warn' }, stream) as unknown as false });

  await app.register(fp(async (f) => f.decorate('prisma', fakePrisma), { name: 'prisma' }));
  await app.register(fp(async (f) => f.decorate('authenticate', async () => {}), { name: 'auth' }));
  await app.register(rbacPlugin);

  app.get(
    '/needs-approve',
    { preHandler: [setUser, app.requireAccess({ permissions: ['contracts.approve'], roles: ['ACCOUNTANT'] })] },
    async () => ({ ok: true }),
  );
  await app.ready();
  return { app, lines };
}

const fallbackWarnings = (lines: Array<Record<string, unknown>>) =>
  lines.filter((l) => l.event === 'rbac.legacy_role_fallback');

test('LIVE DEFECT: a role in the list passes a route whose permission it lacks (fallback grants)', async () => {
  const { app, lines } = await buildApp();
  const res = await app.inject({
    method: 'GET',
    url: '/needs-approve',
    headers: { 'x-uid': 'u1', 'x-role': 'ACCOUNTANT' },
  });
  assert.equal(res.statusCode, 200); // the defect: access granted without the permission

  const warnings = fallbackWarnings(lines);
  assert.equal(warnings.length, 1, 'the fallback grant must be logged');
  assert.equal(warnings[0]!.userId, 'u1');
  assert.equal(warnings[0]!.role, 'ACCOUNTANT');
  assert.deepEqual(warnings[0]!.requiredPermissions, ['contracts.approve']);
  await app.close();
});

test('the permission path grants without any fallback warning', async () => {
  const { app, lines } = await buildApp();
  const res = await app.inject({
    method: 'GET',
    url: '/needs-approve',
    headers: { 'x-uid': 'u2', 'x-role': 'ADMIN' }, // ADMIN holds contracts.approve
  });
  assert.equal(res.statusCode, 200);
  assert.equal(fallbackWarnings(lines).length, 0, 'a genuine permission grant must not warn');
  await app.close();
});

test('a role neither granted the permission nor in the fallback list is denied', async () => {
  const { app, lines } = await buildApp();
  const res = await app.inject({
    method: 'GET',
    url: '/needs-approve',
    headers: { 'x-uid': 'u3', 'x-role': 'VIEWER' },
  });
  assert.equal(res.statusCode, 403);
  assert.equal(fallbackWarnings(lines).length, 0);
  await app.close();
});

test('OWNER is the super-admin short-circuit and never touches the fallback', async () => {
  const { app, lines } = await buildApp();
  const res = await app.inject({
    method: 'GET',
    url: '/needs-approve',
    headers: { 'x-uid': 'u0', 'x-role': RoleName.OWNER },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(fallbackWarnings(lines).length, 0, 'OWNER passes before the permission/fallback logic');
  await app.close();
});
