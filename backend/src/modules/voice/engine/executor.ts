// ============================================================
// Transaction Executor — المرحلة العاشرة.
//
// Runs every step of a SERVER plan inside ONE Prisma transaction: if any step
// throws, the whole turn rolls back (all-or-nothing). Steps write through
// repositories using the shared `tx` and record their own audit entries via the
// passed AuditService, so the domain mutation and its audit trail commit
// atomically — exactly like the hand-written services do. CLIENT plans perform
// no DB work; only their clientActions are returned.
// ============================================================

import type { PrismaClient } from '@prisma/client';
import type { ClientAction, CreatedEntityRef } from '@contractor-plus/shared';
import type { AuditActor, AuditService } from '../../audit/audit.service.js';
import type { Plan, StepExecutionContext } from './voice.types.js';

export interface ExecutionOutcome {
  createdEntities: CreatedEntityRef[];
  message: string;
  clientActions: ClientAction[];
  outputs: Record<string, unknown>;
}

export class Executor {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  async execute(plan: Plan, actor: AuditActor): Promise<ExecutionOutcome> {
    const clientActions = plan.clientActions ?? [];

    if (plan.side === 'client' || plan.steps.length === 0) {
      return {
        createdEntities: [],
        message: plan.summary.title,
        clientActions,
        outputs: {},
      };
    }

    const created: CreatedEntityRef[] = [];
    let message = plan.summary.title;

    const { outputs } = await this.prisma.$transaction(async (tx) => {
      const ctx: StepExecutionContext = { tx, actor, audit: this.audit, outputs: {} };
      for (const step of plan.steps) {
        const result = await step.execute(ctx);
        if (result.createdEntities) created.push(...result.createdEntities);
        if (result.outputs) Object.assign(ctx.outputs, result.outputs);
        if (result.message) message = result.message;
      }
      return { outputs: ctx.outputs };
    });

    return { createdEntities: created, message, clientActions, outputs };
  }
}
