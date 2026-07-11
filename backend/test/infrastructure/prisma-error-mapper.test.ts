import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { mapPrismaError } from '../../src/infrastructure/persistence/prisma-error-mapper.js';
import { ConflictError } from '../../src/shared/errors/conflict.error.js';
import { NotFoundError } from '../../src/shared/errors/not-found.error.js';
import { TimeoutError } from '../../src/shared/errors/timeout.error.js';
import { InternalError } from '../../src/shared/errors/internal.error.js';

const known = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError(`prisma said: ${code} on secret_column`, {
    code,
    clientVersion: '5.22.0',
    meta,
  });

test('P2002 maps to a generic ConflictError without leaking the constraint', () => {
  const mapped = mapPrismaError(known('P2002', { target: ['contract_number'] }));
  assert.ok(mapped instanceof ConflictError);
  assert.equal(mapped.statusCode, 409);
  assert.equal(mapped.code, 'UNIQUE_VIOLATION');
  // No Prisma/DB detail leaks into the wire-visible fields.
  assert.ok(!mapped.message.toLowerCase().includes('constraint'));
  assert.ok(!mapped.message.includes('contract_number'));
  assert.ok(!JSON.stringify(mapped.details ?? {}).includes('contract_number'));
  assert.ok(!mapped.message.includes('prisma'));
});

test('P2002 resolves a friendly code when a constraint mapping is registered', () => {
  const mapped = mapPrismaError(known('P2002', { target: ['contract_number'] }), {
    uniqueConstraints: {
      contract_number: { code: 'CONTRACT_NUMBER_TAKEN', message: 'That contract number is already in use.' },
    },
  });
  assert.equal(mapped.code, 'CONTRACT_NUMBER_TAKEN');
  assert.equal(mapped.message, 'That contract number is already in use.');
});

test('P2025 maps to NotFoundError', () => {
  const mapped = mapPrismaError(known('P2025'));
  assert.ok(mapped instanceof NotFoundError);
  assert.equal(mapped.statusCode, 404);
});

test('P2003 maps to a referenced-entity ConflictError', () => {
  const mapped = mapPrismaError(known('P2003'));
  assert.ok(mapped instanceof ConflictError);
  assert.equal(mapped.code, 'REFERENCED_ENTITY_MISSING');
});

test('P2034 maps to a retryable STALE_WRITE conflict', () => {
  const mapped = mapPrismaError(known('P2034'));
  assert.ok(mapped instanceof ConflictError);
  assert.equal(mapped.code, 'STALE_WRITE');
  assert.equal(mapped.retryable, true);
});

test('P2028 maps to a retryable TimeoutError', () => {
  const mapped = mapPrismaError(known('P2028'));
  assert.ok(mapped instanceof TimeoutError);
  assert.equal(mapped.statusCode, 504);
  assert.equal(mapped.retryable, true);
});

test('an unrecognised known code maps to a generic InternalError carrying the cause', () => {
  const original = known('P2010');
  const mapped = mapPrismaError(original);
  assert.ok(mapped instanceof InternalError);
  assert.equal(mapped.statusCode, 500);
  assert.equal(mapped.message, 'Internal server error'); // no leak
  assert.equal(mapped.details, undefined);
  assert.equal((mapped as { cause?: unknown }).cause, original); // preserved for logs
});

test('an unknown (non-Prisma) error maps to a generic InternalError', () => {
  const original = new Error('kaboom with secret_value');
  const mapped = mapPrismaError(original);
  assert.ok(mapped instanceof InternalError);
  assert.equal(mapped.message, 'Internal server error');
  assert.ok(!mapped.message.includes('secret_value'));
  assert.equal((mapped as { cause?: unknown }).cause, original);
});

test('an existing AppError passes through untouched', () => {
  const original = new ConflictError('already there', 'CUSTOM');
  assert.equal(mapPrismaError(original), original);
});
