import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SystemClock } from '../../src/infrastructure/time/system-clock.js';

// 22:00 UTC — still the 11th in UTC, already the 12th in Asia/Baghdad (UTC+3).
const instant = new Date('2026-07-11T22:00:00Z');

test('now() returns the injected instant', () => {
  const clock = new SystemClock('Asia/Baghdad', () => instant);
  assert.equal(clock.now().getTime(), instant.getTime());
});

test('today() derives the business day in the configured timezone', () => {
  assert.equal(new SystemClock('Asia/Baghdad', () => instant).today().toString(), '2026-07-12');
  assert.equal(new SystemClock('UTC', () => instant).today().toString(), '2026-07-11');
});

test('today() rolls the day correctly for a timezone behind UTC', () => {
  // 02:00 UTC on the 11th is still 20:00 on the 10th in New York (UTC-5/-4).
  const early = new Date('2026-07-11T02:00:00Z');
  assert.equal(new SystemClock('America/New_York', () => early).today().toString(), '2026-07-10');
  assert.equal(new SystemClock('UTC', () => early).today().toString(), '2026-07-11');
});
