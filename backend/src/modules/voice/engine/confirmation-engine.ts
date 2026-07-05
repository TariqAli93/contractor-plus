// ============================================================
// Confirmation Engine — المرحلة الثامنة.
//
// Decides whether a plan may run unattended. Any plan that mutates data MUST be
// confirmed by the user first; read-only / navigation plans run immediately.
// It does not build the summary text (the handler does, since it owns the
// domain semantics) — it owns the POLICY of when consent is required.
// ============================================================

import type { Plan } from './voice.types.js';

export class ConfirmationEngine {
  /** True when the plan must be explicitly confirmed before execution. */
  requiresConfirmation(plan: Plan): boolean {
    return plan.mutates === true;
  }
}
