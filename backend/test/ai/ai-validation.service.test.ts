/**
 * Dedicated tests for ai-validation.service — the security gate of the
 * NL→report path (the spec calls it the most important barrier). Everything
 * here is pure: untrusted JSON in, typed query or clean 422 out.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { AiValidationService } from '../../src/modules/ai-assistant/services/ai-validation.service.js';
import { AppError } from '../../src/shared/errors/app-error.js';

const gate = new AiValidationService();

function rejectedWith(code: string) {
  return (err: unknown) => err instanceof AppError && err.statusCode === 422 && err.code === code;
}

// ---------- valid queries pass, fully typed ----------

test('valid cash-flow query passes; ISO dates become Date objects', () => {
  const q = gate.validateQuery({
    reportType: 'cash-flow',
    filters: { dateFrom: '2026-07-01', dateTo: '2026-07-31' },
  });
  assert.equal(q.reportType, 'cash-flow');
  if (q.reportType === 'cash-flow') {
    assert.ok(q.filters.dateFrom instanceof Date);
    assert.equal(q.filters.dateFrom!.toISOString().slice(0, 10), '2026-07-01');
  }
});

test('valid profitability query with status + sort passes', () => {
  const q = gate.validateQuery({
    reportType: 'project-profitability',
    filters: { status: 'IN_PROGRESS' },
    sortBy: 'name',
    sortDir: 'asc',
  });
  assert.equal(q.reportType, 'project-profitability');
});

test('missing filters defaults to {} (model may omit it)', () => {
  const q = gate.validateQuery({ reportType: 'delayed-projects' });
  assert.deepEqual(q.filters, {});
});

test("groupBy 'project' is accepted where it is the inherent grouping", () => {
  const q = gate.validateQuery({ reportType: 'overdue-payments', groupBy: 'project' });
  assert.equal(q.reportType, 'overdue-payments');
});

// ---------- the spec's acceptance cases ----------

test('explicit out-of-scope refusal → AI_QUERY_OUT_OF_SCOPE (the «احذف كل العملاء» path)', () => {
  assert.throws(
    () => gate.validateQuery({ outOfScope: true, reason: 'طلب حذف بيانات' }),
    rejectedWith('AI_QUERY_OUT_OF_SCOPE'),
  );
});

test('a mutation-shaped object never passes (unknown keys)', () => {
  assert.throws(
    () => gate.validateQuery({ action: 'delete', entity: 'customers' }),
    rejectedWith('AI_QUERY_REJECTED'),
  );
});

test("the spec's own illustrative values are rejected — no such report exists here", () => {
  // Shape is the contract; VALUES must come from the real whitelist.
  assert.throws(
    () =>
      gate.validateQuery({
        reportType: 'project-financial-risk',
        filters: { budgetExceeded: true, noPaymentsForDays: 30 },
        groupBy: 'project',
        sortBy: 'riskScore',
      }),
    rejectedWith('AI_QUERY_REJECTED'),
  );
});

// ---------- whitelist enforcement, key by key ----------

test('unknown top-level key is rejected', () => {
  assert.throws(
    () => gate.validateQuery({ reportType: 'cash-flow', filters: {}, sql: 'DROP TABLE users' }),
    rejectedWith('AI_QUERY_REJECTED'),
  );
});

test('filter not in the whitelist for that type is rejected', () => {
  assert.throws(
    () => gate.validateQuery({ reportType: 'cash-flow', filters: { budgetExceeded: true } }),
    rejectedWith('AI_QUERY_REJECTED'),
  );
});

test("a filter valid for ANOTHER type is still rejected (status on cash-flow)", () => {
  assert.throws(
    () => gate.validateQuery({ reportType: 'cash-flow', filters: { status: 'IN_PROGRESS' } }),
    rejectedWith('AI_QUERY_REJECTED'),
  );
});

test('customerId is deliberately NOT model-facing — rejected everywhere', () => {
  assert.throws(
    () =>
      gate.validateQuery({
        reportType: 'delayed-projects',
        filters: { customerId: '3f8e4b1c-0000-4000-8000-000000000000' },
      }),
    rejectedWith('AI_QUERY_REJECTED'),
  );
});

test('sortBy outside the whitelist is rejected (riskScore)', () => {
  assert.throws(
    () =>
      gate.validateQuery({ reportType: 'project-profitability', filters: {}, sortBy: 'riskScore' }),
    rejectedWith('AI_QUERY_REJECTED'),
  );
});

test("groupBy other than the inherent 'project' is rejected", () => {
  assert.throws(
    () => gate.validateQuery({ reportType: 'overdue-payments', groupBy: 'customer' }),
    rejectedWith('AI_QUERY_REJECTED'),
  );
});

test('bad enum value inside a whitelisted filter is rejected', () => {
  assert.throws(
    () => gate.validateQuery({ reportType: 'project-profitability', filters: { status: 'HACKED' } }),
    rejectedWith('AI_QUERY_REJECTED'),
  );
});

test('sortBy/sortDir are not allowed on report types without them', () => {
  assert.throws(
    () => gate.validateQuery({ reportType: 'delayed-projects', sortBy: 'name' }),
    rejectedWith('AI_QUERY_REJECTED'),
  );
});

// ---------- value validation ----------

test('non-ISO date strings are rejected', () => {
  assert.throws(
    () => gate.validateQuery({ reportType: 'cash-flow', filters: { dateFrom: 'الشهر الماضي' } }),
    rejectedWith('AI_QUERY_REJECTED'),
  );
});

test('impossible calendar dates are rejected (2026-13-45)', () => {
  assert.throws(
    () => gate.validateQuery({ reportType: 'cash-flow', filters: { dateFrom: '2026-13-45' } }),
    rejectedWith('AI_QUERY_REJECTED'),
  );
});

test('dateFrom after dateTo is rejected (cross-field semantics)', () => {
  assert.throws(
    () =>
      gate.validateQuery({
        reportType: 'cash-flow',
        filters: { dateFrom: '2026-08-01', dateTo: '2026-07-01' },
      }),
    rejectedWith('AI_QUERY_REJECTED'),
  );
});

test('sortDir without sortBy is rejected', () => {
  assert.throws(
    () => gate.validateQuery({ reportType: 'project-profitability', filters: {}, sortDir: 'asc' }),
    rejectedWith('AI_QUERY_REJECTED'),
  );
});

// ---------- garbage & hostile inputs ----------

for (const [label, value] of [
  ['null', null],
  ['array', []],
  ['string', 'cash-flow'],
  ['number', 42],
  ['empty object', {}],
] as const) {
  test(`garbage input (${label}) is rejected, never crashes`, () => {
    assert.throws(() => gate.validateQuery(value), rejectedWith('AI_QUERY_REJECTED'));
  });
}

test('__proto__ / constructor keys are rejected (prototype-pollution attempt)', () => {
  // JSON.parse creates these as OWN properties — strict() must flag them.
  const hostile = JSON.parse(
    '{"reportType":"cash-flow","filters":{},"__proto__":{"polluted":true}}',
  ) as unknown;
  assert.throws(() => gate.validateQuery(hostile), rejectedWith('AI_QUERY_REJECTED'));
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('out-of-scope with extra keys is NOT treated as a refusal — rejected instead', () => {
  // A malformed refusal must not smuggle data through the refusal branch.
  assert.throws(
    () => gate.validateQuery({ outOfScope: true, reportType: 'cash-flow', filters: {} }),
    rejectedWith('AI_QUERY_REJECTED'),
  );
});
