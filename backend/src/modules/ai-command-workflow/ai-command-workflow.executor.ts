// ============================================================
// Executor — runs a CONFIRMED, already-resolved plan.
//
// Guarantees enforced here (the program decides, not the AI):
//   - every step's action must be registered (else the plan is rejected);
//   - the caller must hold every required permission for every step;
//   - a plan with ≥2 data-changing steps runs inside ONE $transaction (all steps
//     use the tx-aware `runInTx` runners), so a failure rolls the whole thing
//     back; a single mutation step runs in its own transaction;
//   - created ids are threaded to later steps via PlanRefs (the AI never sees ids).
// ============================================================

import type { PrismaClient } from '@prisma/client';
import { getAction } from './ai-command-workflow.registry.js';
import type { ActionDeps } from './ai-command-workflow.registry.js';
import type {
  ExecContext,
  ExecutedActionInfo,
  PlanRefs,
  StepOutcome,
  StoredPlan,
  WorkflowStep,
} from './ai-command-workflow.types.js';
import { ForbiddenError } from '../../shared/errors/forbidden.error.js';
import { ValidationError } from '../../shared/errors/validation.error.js';

export interface ExecutionOutput {
  executedActions: ExecutedActionInfo[];
  createdEntityIds: Record<string, string>;
  updatedEntityIds: Record<string, string>;
}

/** entity name → the key used in created/updated maps (and the response). */
function entityKey(entity: string): string {
  const map: Record<string, string> = {
    Customer: 'client',
    Contract: 'contract',
    Project: 'project',
    Payment: 'payment',
    ProjectCost: 'expense',
    Material: 'material',
    User: 'user',
    Role: 'role',
    Currency: 'currency',
    CompanyProfile: 'company',
    SystemSetting: 'settings',
  };
  return map[entity] ?? entity.toLowerCase();
}

/** Reject any plan naming an action that isn't in the registry (defense in depth —
 *  the service checks this too, before a plan is ever stored). */
export function assertAllRegistered(steps: WorkflowStep[]): void {
  for (const step of steps) {
    if (!getAction(step.action)) {
      throw new ValidationError(`إجراء غير مُسجّل: ${step.action}`, { action: ['unregistered'] });
    }
  }
}

/** Throw ForbiddenError if the caller lacks any permission a step requires. */
export function assertPermitted(steps: WorkflowStep[], ctx: ExecContext): void {
  for (const step of steps) {
    const def = getAction(step.action);
    if (!def) continue;
    const missing = def.requiredPermissions.filter((p) => !ctx.permissions.has(p));
    if (missing.length > 0) {
      throw new ForbiddenError(
        `لا تملك صلاحية تنفيذ "${step.action}" (${missing.join(', ')})`,
        'INSUFFICIENT_PERMISSION',
      );
    }
  }
}

function record(output: ExecutionOutput, outcome: StepOutcome | null, action: string): void {
  if (!outcome) return;
  output.executedActions.push({
    action,
    entity: outcome.entity,
    entityId: outcome.entityId,
    operation: outcome.operation,
  });
  const bucket = outcome.operation === 'create' ? output.createdEntityIds : output.updatedEntityIds;
  bucket[entityKey(outcome.entity)] = outcome.entityId;
}

/**
 * Execute a resolved plan. Read-only query steps are skipped (queries never run
 * through /confirm). Throws on any failure; for the multi-step path the whole
 * transaction is rolled back.
 */
export async function executePlan(
  prisma: PrismaClient,
  deps: ActionDeps,
  plan: StoredPlan,
  ctx: ExecContext,
): Promise<ExecutionOutput> {
  assertAllRegistered(plan.steps);
  assertPermitted(plan.steps, ctx);

  const output: ExecutionOutput = { executedActions: [], createdEntityIds: {}, updatedEntityIds: {} };
  const refs: PlanRefs = { ...plan.refs };

  const mutationSteps = plan.steps.filter((s) => getAction(s.action)?.kind === 'mutation');

  if (mutationSteps.length >= 2) {
    // Atomic path — every mutation must be tx-aware so one transaction covers all.
    for (const step of mutationSteps) {
      if (!getAction(step.action)?.runInTx) {
        throw new ValidationError(
          `لا يمكن تنفيذ "${step.action}" ضمن سير عمل مركّب`,
          { action: ['not_composable'] },
        );
      }
    }
    await prisma.$transaction(async (tx) => {
      for (const step of mutationSteps) {
        const def = getAction(step.action)!;
        const outcome = await def.runInTx!(deps, tx, ctx, step.data, refs);
        record(output, outcome, step.action);
      }
    });
  } else if (mutationSteps.length === 1) {
    // Single mutation — the service method opens its own transaction.
    const step = mutationSteps[0]!;
    const def = getAction(step.action)!;
    if (def.runStandalone) {
      const outcome = await def.runStandalone(deps, ctx, step.data, refs);
      record(output, outcome, step.action);
    } else if (def.runInTx) {
      await prisma.$transaction(async (tx) => {
        const outcome = await def.runInTx!(deps, tx, ctx, step.data, refs);
        record(output, outcome, step.action);
      });
    }
  }

  return output;
}
