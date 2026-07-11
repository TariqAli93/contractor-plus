import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Principal } from '../../src/domain/shared/principal.js';
import { ForbiddenError } from '../../src/shared/errors/forbidden.error.js';

const ctx = { traceId: 't1', ipAddress: '127.0.0.1', userAgent: 'test' };

test('a user holds exactly its granted permissions', () => {
  const p = Principal.user({
    userId: 'u1',
    roleName: 'ACCOUNTANT',
    permissions: ['payments.read', 'payments.settle'],
    context: ctx,
  });
  assert.equal(p.can('payments.settle'), true);
  assert.equal(p.can('contracts.approve'), false);
});

test('require() throws ForbiddenError with the stable code', () => {
  const p = Principal.user({
    userId: 'u1',
    roleName: 'ACCOUNTANT',
    permissions: ['payments.read'],
    context: ctx,
  });
  assert.doesNotThrow(() => p.require('payments.read'));
  assert.throws(
    () => p.require('contracts.approve'),
    (err: unknown) =>
      err instanceof ForbiddenError && (err as ForbiddenError).code === 'INSUFFICIENT_PERMISSION',
  );
});

test('OWNER is a super-admin short-circuit', () => {
  const owner = Principal.user({
    userId: 'u0',
    roleName: 'OWNER',
    permissions: [],
    context: ctx,
  });
  assert.equal(owner.isOwner, true);
  assert.equal(owner.can('anything.at.all'), true);
  assert.doesNotThrow(() => owner.require('contracts.approve'));
});

test('the system principal is NOT a super-user', () => {
  const bare = Principal.system('overdue-sweep');
  assert.equal(bare.isOwner, false);
  assert.equal(bare.userId, null);
  assert.equal(bare.can('payments.read'), false);
  assert.throws(() => bare.require('payments.read'), ForbiddenError);

  const granted = Principal.system('price-projector', ['price-history.write']);
  assert.equal(granted.can('price-history.write'), true);
  assert.equal(granted.can('contracts.approve'), false);
});

test('the system principal carries a traceable, person-free context', () => {
  const p = Principal.system('overdue-sweep');
  assert.equal(p.context.traceId, 'system:overdue-sweep');
  assert.equal(p.context.ipAddress, null);
});
