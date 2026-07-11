import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalDate } from '../../src/domain/shared/local-date.js';

test('parses a strict ISO date', () => {
  const d = LocalDate.parse('2026-07-11');
  assert.equal(d.year, 2026);
  assert.equal(d.month, 7);
  assert.equal(d.day, 11);
  assert.equal(d.toString(), '2026-07-11');
});

test('rejects a malformed or non-calendar string', () => {
  assert.throws(() => LocalDate.parse('2026-7-1'), RangeError); // not zero-padded
  assert.throws(() => LocalDate.parse('2026/07/11'), RangeError);
  assert.throws(() => LocalDate.parse('2026-13-01'), RangeError);
  assert.throws(() => LocalDate.parse('2026-02-30'), RangeError); // Feb 30 is not real
  assert.throws(() => LocalDate.parse('abc'), RangeError);
});

test('of() rejects an impossible day', () => {
  assert.throws(() => LocalDate.of(2026, 2, 30), RangeError);
  assert.doesNotThrow(() => LocalDate.of(2024, 2, 29)); // 2024 is a leap year
  assert.throws(() => LocalDate.of(2026, 2, 29), RangeError); // 2026 is not
});

test('daysUntil is signed and timezone-free across a month boundary', () => {
  assert.equal(LocalDate.parse('2026-06-15').daysUntil(LocalDate.parse('2026-07-15')), 30);
  assert.equal(LocalDate.parse('2026-07-15').daysUntil(LocalDate.parse('2026-06-15')), -30);
});

test('daysUntil across a year boundary', () => {
  assert.equal(LocalDate.parse('2026-12-31').daysUntil(LocalDate.parse('2027-01-01')), 1);
});

test('daysSince is the inverse of daysUntil', () => {
  const a = LocalDate.parse('2026-06-01');
  const b = LocalDate.parse('2026-06-25');
  assert.equal(b.daysSince(a), 24);
  assert.equal(a.daysSince(b), -24);
});

test('addDays moves forward and backward, crossing months', () => {
  assert.equal(LocalDate.parse('2026-07-11').addDays(30).toString(), '2026-08-10');
  assert.equal(LocalDate.parse('2026-07-01').addDays(-1).toString(), '2026-06-30');
  assert.equal(LocalDate.parse('2026-03-01').addDays(-1).toString(), '2026-02-28');
});

test('comparison predicates', () => {
  const early = LocalDate.parse('2026-06-15');
  const late = LocalDate.parse('2026-07-15');
  assert.equal(early.isBefore(late), true);
  assert.equal(late.isAfter(early), true);
  assert.equal(early.equals(LocalDate.parse('2026-06-15')), true);
  assert.equal(early.compareTo(late), -1);
  assert.equal(late.compareTo(early), 1);
  assert.equal(early.compareTo(LocalDate.parse('2026-06-15')), 0);
});

test('the off-by-one guarantee: a business day never shifts by timezone', () => {
  // A raw `new Date('2026-07-11')` is midnight UTC — the 10th in the Americas.
  // LocalDate carries no instant, so the day is invariant regardless of host TZ.
  const due = LocalDate.parse('2026-07-11');
  assert.equal(due.toString(), '2026-07-11');
  assert.equal(due.toUtcDate().toISOString(), '2026-07-11T00:00:00.000Z');
});
