// ============================================================
// WorkflowManager — the Saga orchestrator for compound commands.
//
// Why a Saga (and not one big transaction)? A workflow PAUSES across HTTP turns
// for clarification/confirmation — you cannot hold a DB transaction open that
// long. So each intent commits in its OWN transaction (via the Executor), and if
// a LATER intent fails (or the user cancels mid-flight) we run COMPENSATIONS for
// the already-committed intents in reverse order. State (done / remaining /
// chain) is persisted on the session so the workflow survives and resumes.
//
// Lifecycle:
//   begin → [clarify ↔ answer]* → confirm → run → executed | (compensate → reject)
// ============================================================

import { randomUUID } from 'node:crypto';
import {
  type ClientAction,
  type ConfirmationView,
  type CreatedEntityRef,
  type EntityBag,
} from '@contractor-plus/shared';
import type { PrismaClient } from '@prisma/client';
import type { AuditActor, AuditService } from '../../audit/audit.service.js';
import type { IntentRegistry } from './intent-registry.js';
import type { WorkflowEngine } from './workflow-engine.js';
import type { PermissionEngine } from './permission-engine.js';
import type { Executor } from './executor.js';
import type { SessionContext, VoicePrincipal } from './voice.types.js';
import type {
  CompletedStep,
  PendingWorkflow,
  WorkflowInvocation,
} from '../voice.types.js';

export type WorkflowOutcome =
  | { kind: 'clarify'; question: string; awaitingSlot: string }
  | { kind: 'confirm'; summary: ConfirmationView; planId: string }
  | {
      kind: 'executed';
      message: string;
      createdEntities: CreatedEntityRef[];
      clientActions: ClientAction[];
    }
  | {
      kind: 'rejected';
      reason: 'permission_denied' | 'invalid' | 'failed';
      message: string;
      missingPermissions?: string[];
    };

export class WorkflowManager {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly registry: IntentRegistry,
    private readonly workflow: WorkflowEngine,
    private readonly permission: PermissionEngine,
    private readonly executor: Executor,
  ) {}

  /** Create a workflow from ordered invocations and validate/confirm it. */
  begin(
    invocations: WorkflowInvocation[],
    baseChain: SessionContext,
    actor: AuditActor,
  ): { workflow: PendingWorkflow; outcome: WorkflowOutcome } {
    const workflow: PendingWorkflow = {
      planId: randomUUID(),
      phase: 'awaiting_confirmation',
      started: false,
      pending: invocations,
      completed: [],
      chain: stripControl(baseChain),
    };
    return { workflow, outcome: this.validate(workflow) };
  }

  /** Apply a clarification answer to the awaiting invocation, then re-validate. */
  answer(
    workflow: PendingWorkflow,
    freshBag: EntityBag,
    transcript: string,
    actor: AuditActor,
  ): WorkflowOutcome {
    const idx = workflow.awaitingIndex ?? 0;
    const inv = workflow.pending[idx];
    if (!inv) return this.validate(workflow);

    inv.bag = { ...inv.bag, ...stripUndefined(freshBag) };
    const handler = this.registry.get(inv.intent);
    const slot = handler?.requiredSlots.find((s) => s.name === workflow.awaitingSlot);
    const current = slot?.read(inv.bag);
    if (slot?.fillFromAnswer && (current === undefined || current === null || current === '')) {
      slot.fillFromAnswer(inv.bag, transcript);
    }
    return this.validate(workflow);
  }

  /** Validate utterance-slots of every pending invocation; clarify or confirm. */
  private validate(workflow: PendingWorkflow): WorkflowOutcome {
    for (let i = 0; i < workflow.pending.length; i++) {
      const inv = workflow.pending[i]!;
      const handler = this.registry.get(inv.intent);
      if (!handler) continue;
      const missing = handler.requiredSlots.find((s) => {
        const v = s.read(inv.bag);
        return v === undefined || v === null || v === '';
      });
      if (missing) {
        workflow.phase = 'awaiting_clarification';
        workflow.awaitingIndex = i;
        workflow.awaitingSlot = missing.name;
        return { kind: 'clarify', question: missing.question, awaitingSlot: missing.name };
      }
    }

    workflow.phase = 'awaiting_confirmation';
    workflow.awaitingIndex = undefined;
    workflow.awaitingSlot = undefined;
    return { kind: 'confirm', planId: workflow.planId, summary: this.buildSummary(workflow) };
  }

  private buildSummary(workflow: PendingWorkflow): ConfirmationView {
    const lines = workflow.pending.map((inv, i) => {
      const handler = this.registry.get(inv.intent);
      const text = handler?.summarize?.(inv.bag, workflow.chain) ?? inv.intent;
      return { label: `${i + 1}`, value: text };
    });
    return { title: 'سيتم تنفيذ سلسلة العمليات التالية', mutates: true, lines };
  }

  /** Execute the confirmed workflow as a Saga (per-intent commits + compensation). */
  async run(
    workflow: PendingWorkflow,
    principal: VoicePrincipal,
    actor: AuditActor,
  ): Promise<WorkflowOutcome> {
    workflow.started = true;
    const createdEntities: CreatedEntityRef[] = [];
    const clientActions: ClientAction[] = [];
    const messages: string[] = [];

    while (workflow.pending.length > 0) {
      const inv = workflow.pending[0]!;
      const handler = this.registry.get(inv.intent);
      if (!handler) {
        workflow.pending.shift();
        continue;
      }

      const planning = await this.workflow.buildPlan(
        handler,
        inv.bag,
        workflow.chain,
        actor,
        inv.transcript,
      );

      // A chain dependency missing mid-execution (e.g. no project) can't be
      // answered by voice — fail and compensate what already committed.
      if (planning.kind !== 'plan') {
        await this.compensate(workflow.completed, actor);
        return {
          kind: 'rejected',
          reason: 'invalid',
          message: `تعذّر إكمال السلسلة: ${planning.question}`,
        };
      }

      const verdict = this.permission.evaluate(planning.plan, principal);
      if (!verdict.allowed) {
        await this.compensate(workflow.completed, actor);
        return {
          kind: 'rejected',
          reason: 'permission_denied',
          message: 'ليس لديك صلاحية تنفيذ إحدى العمليات في السلسلة.',
          missingPermissions: verdict.missing,
        };
      }

      try {
        const result = await this.executor.execute(planning.plan, actor);
        createdEntities.push(...result.createdEntities);
        clientActions.push(...result.clientActions);
        if (result.message) messages.push(result.message);
        workflow.completed.push({ intent: inv.intent, outputs: result.outputs });
        mergeChain(workflow.chain, result.outputs);
        workflow.pending.shift();
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'فشل غير متوقع';
        await this.compensate(workflow.completed, actor);
        return {
          kind: 'rejected',
          reason: 'failed',
          message: `فشلت العملية "${inv.intent}" (${reason}) — تم التراجع عن كل العمليات السابقة.`,
        };
      }
    }

    return {
      kind: 'executed',
      message: messages.join(' '),
      createdEntities,
      clientActions,
    };
  }

  /** Run compensations for committed steps in REVERSE order, each in its own tx. */
  private async compensate(completed: CompletedStep[], actor: AuditActor): Promise<void> {
    for (let i = completed.length - 1; i >= 0; i--) {
      const step = completed[i]!;
      const handler = this.registry.get(step.intent);
      if (!handler?.compensate) continue;
      try {
        await this.prisma.$transaction((tx) =>
          handler.compensate!(step.outputs, { tx, actor, audit: this.audit }),
        );
      } catch {
        // Best-effort: a failing compensation must not abort the others.
      }
    }
  }
}

function mergeChain(chain: SessionContext, outputs: Record<string, unknown>): void {
  if (typeof outputs.projectId === 'string') chain.lastProjectId = outputs.projectId;
  if (typeof outputs.contractId === 'string') chain.lastContractId = outputs.contractId;
  if (typeof outputs.contractNumber === 'string') chain.lastContractNumber = outputs.contractNumber;
  if (typeof outputs.customerId === 'string') chain.lastCustomerId = outputs.customerId;
  if (typeof outputs.paymentId === 'string') chain.lastPaymentId = outputs.paymentId;
}

/** Keep only the durable chain fields when seeding a workflow (drop pending*). */
function stripControl(ctx: SessionContext): SessionContext {
  return {
    lastProjectId: ctx.lastProjectId,
    lastProjectName: ctx.lastProjectName,
    lastCustomerId: ctx.lastCustomerId,
    lastCustomerName: ctx.lastCustomerName,
    lastContractId: ctx.lastContractId,
    lastContractNumber: ctx.lastContractNumber,
    lastPaymentId: ctx.lastPaymentId,
    entities: ctx.entities,
  };
}

function stripUndefined(obj: EntityBag): EntityBag {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as EntityBag;
}
