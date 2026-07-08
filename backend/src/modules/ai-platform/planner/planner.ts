// ============================================================
// AI Planner — turns a parsed intent (+ resolved context) into an ordered,
// possibly multi-tool execution strategy (a Plan of PlanSteps). The PROGRAM
// always sets requiresConfirmation (any mutation ⇒ true), never the AI.
//
// Phase 1: a single NL-capable tool whose `interpret()` produces the concrete
// mutation step to confirm, so the planner mainly wraps that step into a Plan.
// The multi-step, cross-tool planning path is ready for Phase 3 domain tools.
// ============================================================

import type { Plan, PlanStep } from '../ai-platform.types.js';

export class Planner {
  /** Wrap the tool-provided confirmation step into a parkable Plan. */
  planConfirmation(step: PlanStep, summary: string, confidence: number): Plan {
    return { steps: [step], summary, requiresConfirmation: true, confidence };
  }
}
