import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { Money, MONEY_SCALE } from '../../src/domain/shared/money.js';

test('adds without float drift (the reason Decimal exists)', () => {
  assert.ok(Money.of('0.1').plus('0.2').equals(Money.of('0.3')));
});

test('is immutable: operations return new instances', () => {
  const a = Money.of('100');
  const b = a.plus('50');
  assert.equal(a.toString(), '100.0000');
  assert.equal(b.toString(), '150.0000');
});

test('serializes at the fixed money scale (4dp), not 2', () => {
  assert.equal(MONEY_SCALE, 4);
  assert.equal(Money.of('125000').toString(), '125000.0000');
  assert.equal(JSON.stringify({ total: Money.of('12.3456') }), '{"total":"12.3456"}');
});

test('format() is a separate DISPLAY concern from the wire scale', () => {
  assert.equal(Money.of('125000.5').format(2), '125000.50');
  assert.equal(Money.of('125000.5').format(0), '125001'); // half-up
});

test('rejects non-finite input', () => {
  assert.throws(() => Money.of(Number.NaN), RangeError);
  assert.throws(() => Money.of(Number.POSITIVE_INFINITY), RangeError);
  assert.throws(() => Money.of('not-money'), Error);
});

test('times multiplies by a scalar exactly', () => {
  assert.equal(Money.of('300').times(85).toString(), '25500.0000');
  assert.equal(Money.of('342.1234').times('12.5').toString(), '4276.5425');
});

test('dividedBy rounds to the money scale and refuses division by zero', () => {
  assert.equal(Money.of('100').dividedBy(3).toString(), '33.3333');
  assert.throws(() => Money.of('100').dividedBy(0), RangeError);
});

test('sign predicates treat zero as neither positive nor negative', () => {
  assert.equal(Money.zero().isZero(), true);
  assert.equal(Money.zero().isPositive(), false);
  assert.equal(Money.zero().isNegative(), false);
  assert.equal(Money.of('-5').isNegative(), true);
  assert.equal(Money.of('5').isPositive(), true);
});

test('comparison and min/max', () => {
  assert.equal(Money.of('10').lessThan('20'), true);
  assert.equal(Money.of('20').greaterThanOrEqual('20'), true);
  assert.equal(Money.min('10', '20').toString(), '10.0000');
  assert.equal(Money.max('10', '20').toString(), '20.0000');
});

test('sum of an empty list is zero', () => {
  assert.equal(Money.sum([]).toString(), '0.0000');
  assert.equal(Money.sum(['10', '20.5', Money.of('0.5')]).toString(), '31.0000');
});

test('allocate loses not a single minor unit', () => {
  const parts = Money.of('100').allocate([1, 1, 1]);
  assert.deepEqual(
    parts.map((p) => p.toString()),
    ['33.3334', '33.3333', '33.3333'],
  );
  assert.equal(Money.sum(parts).equals(Money.of('100')), true);
});

test('allocate handles the single-minor-unit penny problem', () => {
  const parts = Money.of('0.0001').allocate([1, 1]);
  assert.deepEqual(
    parts.map((p) => p.toString()),
    ['0.0001', '0.0000'],
  );
  assert.equal(Money.sum(parts).toString(), '0.0001');
});

test('allocate respects unequal weights and still sums exactly', () => {
  const parts = Money.of('100').allocate([1, 3]);
  assert.deepEqual(
    parts.map((p) => p.toString()),
    ['25.0000', '75.0000'],
  );
  assert.equal(Money.sum(parts).equals(Money.of('100')), true);
});

test('allocate works for a negative amount (a refund split)', () => {
  const parts = Money.of('-100').allocate([1, 1, 1]);
  assert.equal(Money.sum(parts).equals(Money.of('-100')), true);
});

test('allocate rejects degenerate weights', () => {
  assert.throws(() => Money.of('100').allocate([]), RangeError);
  assert.throws(() => Money.of('100').allocate([0, 0]), RangeError);
  assert.throws(() => Money.of('100').allocate([1, -1]), RangeError);
});

test('interoperates with a raw Prisma.Decimal both ways', () => {
  const m = Money.of(new Prisma.Decimal('42.5'));
  assert.equal(m.toString(), '42.5000');
  assert.ok(m.toDecimal() instanceof Prisma.Decimal);
});
