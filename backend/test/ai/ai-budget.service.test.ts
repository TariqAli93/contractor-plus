/**
 * Phase-6 unit tests for AiBudgetService — monthly usage math and the ceiling
 * gate. The repository's token aggregation is faked (its Prisma queries are
 * exercised live in the acceptance run).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { AiBudgetService } from '../../src/modules/ai-assistant/services/ai-budget.service.js';
import type { AiAssistantRepository } from '../../src/modules/ai-assistant/ai-assistant.repository.js';
import { AppError } from '../../src/shared/errors/app-error.js';

function fakeRepo(prompt: number, completion: number, count = 1) {
  return {
    sumTokensSince: async () => ({ prompt, completion, count }),
    usageByOperationSince: async () => [
      { operationType: 'REPORT_NARRATIVE', tokens: prompt + completion, count },
    ],
  } as unknown as AiAssistantRepository;
}

test('no budget configured → unlimited: never over budget, budget/remaining null', async () => {
  const svc = new AiBudgetService(fakeRepo(1000, 500), async () => undefined);
  assert.equal(await svc.isOverBudget(), false);
  const usage = await svc.getMonthlyUsage();
  assert.equal(usage.totalTokens, 1500);
  assert.equal(usage.budget, null);
  assert.equal(usage.remaining, null);
  assert.equal(usage.overBudget, false);
  await svc.assertWithinBudget(); // does not throw
});

test('under budget: remaining computed, not over', async () => {
  const svc = new AiBudgetService(fakeRepo(600, 300), async () => 2000);
  const usage = await svc.getMonthlyUsage();
  assert.equal(usage.totalTokens, 900);
  assert.equal(usage.budget, 2000);
  assert.equal(usage.remaining, 1100);
  assert.equal(usage.overBudget, false);
  assert.equal(await svc.isOverBudget(), false);
});

test('at/over budget: overBudget true, remaining floored at 0, assert throws 429', async () => {
  const svc = new AiBudgetService(fakeRepo(1500, 600), async () => 2000);
  const usage = await svc.getMonthlyUsage();
  assert.equal(usage.totalTokens, 2100);
  assert.equal(usage.overBudget, true);
  assert.equal(usage.remaining, 0); // never negative
  assert.equal(await svc.isOverBudget(), true);
  await assert.rejects(
    svc.assertWithinBudget(),
    (err: unknown) =>
      err instanceof AppError && err.statusCode === 429 && err.code === 'AI_BUDGET_EXCEEDED',
  );
});

test('exactly at budget counts as over (>= boundary)', async () => {
  const svc = new AiBudgetService(fakeRepo(1000, 1000), async () => 2000);
  assert.equal(await svc.isOverBudget(), true);
});

test('usage.byOperation is sorted by tokens desc', async () => {
  const repo = {
    sumTokensSince: async () => ({ prompt: 10, completion: 10, count: 3 }),
    usageByOperationSince: async () => [
      { operationType: 'SAVE_GUARD', tokens: 5, count: 1 },
      { operationType: 'REPORT_NARRATIVE', tokens: 50, count: 1 },
      { operationType: 'NL_REPORT_QUERY', tokens: 20, count: 1 },
    ],
  } as unknown as AiAssistantRepository;
  const usage = await new AiBudgetService(repo, async () => 1000).getMonthlyUsage();
  assert.deepEqual(
    usage.byOperation.map((o) => o.operationType),
    ['REPORT_NARRATIVE', 'NL_REPORT_QUERY', 'SAVE_GUARD'],
  );
});
