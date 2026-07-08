// ============================================================
// Tool Executor — runs a confirmed plan (generalizes ai-command's executePlan).
// Guarantees: every step registered + permitted; ≥2 mutations run inside ONE
// $transaction (all tx-aware `runInTx`); a single mutation runs via its own
// transaction (`runStandalone`, e.g. delegating to an existing service). Created
// ids thread between steps via refs. Any failure rolls back the whole plan.
// ============================================================

import type { PrismaClient } from '@prisma/client';
import { ValidationError } from '../../../shared/errors/validation.error.js';
import { assertPermitted, assertRegistered, qualify } from './permission-validator.js';
import type { ToolRegistry } from '../registry/tool-registry.js';
import type { PlatformContext, SessionHandle } from '../registry/tool.contract.js';
import type { ActionOutcome, ExecutionResult, Plan } from '../ai-platform.types.js';

export async function executePlan(
  prisma: PrismaClient,
  registry: ToolRegistry,
  handle: SessionHandle,
  plan: Plan,
  ctx: PlatformContext,
): Promise<ExecutionResult> {
  assertRegistered(plan, registry);
  assertPermitted(plan, ctx, registry);

  const output: ExecutionResult = { executedActions: [], createdEntityIds: {}, result: null };
  const refs: Record<string, string> = { ...handle.contextRefs };

  const record = (outcome: ActionOutcome | null): void => {
    if (!outcome) return;
    output.executedActions.push({ entity: outcome.entity, entityId: outcome.entityId, operation: outcome.operation });
    output.createdEntityIds[outcome.refKey ?? outcome.entity.toLowerCase()] = outcome.entityId;
    if (outcome.data !== undefined) output.result = outcome.data;
    if (outcome.refKey) refs[outcome.refKey] = outcome.entityId;
  };

  const mutations = plan.steps.filter((s) => registry.getAction(qualify(s))?.action.kind === 'mutation');

  if (mutations.length >= 2) {
    for (const s of mutations) {
      if (!registry.getAction(qualify(s))?.action.runInTx) {
        throw new ValidationError(`لا يمكن تنفيذ "${qualify(s)}" ضمن سير عمل مركّب`, { action: ['not_composable'] });
      }
    }
    await prisma.$transaction(async (tx) => {
      for (const s of mutations) {
        const { action } = registry.getAction(qualify(s))!;
        record(await action.runInTx!(ctx, tx, handle, s.input, refs));
      }
    });
  } else if (mutations.length === 1) {
    const s = mutations[0]!;
    const { action } = registry.getAction(qualify(s))!;
    if (action.runStandalone) {
      record(await action.runStandalone(ctx, handle, s.input, refs));
    } else if (action.runInTx) {
      await prisma.$transaction(async (tx) => record(await action.runInTx!(ctx, tx, handle, s.input, refs)));
    } else {
      // A mutation with no runner would otherwise silently commit NOTHING and
      // return an empty success — a confirmed action that never ran. Fail loud.
      throw new ValidationError(`الإجراء "${qualify(s)}" لا يملك مُنفّذاً صالحاً`, { action: ['no_executor'] });
    }
  }

  return output;
}
