// ============================================================
// Workflow Engine — slot-fill gate + plan construction.
//
// المرحلة الرابعة (Workflow) + المرحلة الثالثة عشرة (Smart Suggestions): before a
// handler can plan, every required slot must be present. The first missing slot
// becomes a clarify question ("ما هي مساحة البيت؟"). Once slots are satisfied,
// the handler expands the intent into an ordered, multi-step plan.
// ============================================================

import type { EntityBag } from '@contractor-plus/shared';
import type { IntentHandler, PlanInput, PlanningOutcome, SessionContext } from './voice.types.js';
import type { AuditActor } from '../../audit/audit.service.js';
import { ClarifyError } from './clarify-error.js';

export class WorkflowEngine {
  async buildPlan(
    handler: IntentHandler,
    bag: EntityBag,
    context: SessionContext,
    actor: AuditActor,
    transcript = '',
  ): Promise<PlanningOutcome> {
    const missing = handler.requiredSlots.filter((slot) => {
      const v = slot.read(bag);
      return v === undefined || v === null || v === '';
    });

    const first = missing[0];
    if (first) {
      return {
        kind: 'clarify',
        missingSlots: missing.map((s) => s.name),
        question: first.question,
      };
    }

    const input: PlanInput = { intent: handler.intent, bag, context, actor, transcript };
    try {
      const plan = await handler.plan(input);
      return { kind: 'plan', plan };
    } catch (err) {
      // A handler may discover mid-plan that it still needs input (e.g. no
      // template matched). It signals this with ClarifyError → a clarify turn.
      if (err instanceof ClarifyError) {
        return { kind: 'clarify', missingSlots: [err.slot], question: err.question };
      }
      throw err;
    }
  }
}
