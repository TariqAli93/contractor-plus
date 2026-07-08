// ============================================================
// AI Operating Platform — shared internal types.
//
// The contracts between the pipeline stages (session → memory → context → intent
// → planner → rules/KB → registry → executor → validator → audit). The AI only
// proposes; the program decides, computes, gates, confirms, and executes.
// ============================================================

/** Authenticated caller + audit actor, threaded into every stage. */
export interface Principal {
  userId: string;
  role: string;
  actor: { userId: string; ipAddress?: string; userAgent?: string };
}

/** Intent Parser output — objective, entities, gaps, confidence. NO execution. */
export interface ParsedIntent {
  objective: string;
  targetTool: string | null;
  entities: Record<string, unknown>;
  missingInfo: string[];
  confidence: number;
}

/** One ordered tool action in a plan; `dependsOn` threads outputs between steps. */
export interface PlanStep {
  toolName: string;
  action: string; // qualified, e.g. "estimation.confirm"
  input: Record<string, unknown>;
  dependsOn?: number[];
}

/** A resolved, ordered execution strategy — the program sets requiresConfirmation. */
export interface Plan {
  steps: PlanStep[];
  summary: string;
  requiresConfirmation: boolean;
  confidence: number;
}

/** References + preferences + prior working state, resolved BEFORE the LLM. */
export interface ResolvedContext {
  refs: Record<string, string>;
  preferences: Record<string, unknown>;
  priorState: unknown | null;
  clarify?: { message: string; missing: string[]; options?: RefOption[] };
}
export interface RefOption {
  slot: string;
  id: string;
  label: string;
}

/** What a tool's NL-entry `interpret()` returns for one turn. */
export type ToolTurnResult =
  | { kind: 'clarification'; question: string; missing: string[]; options?: RefOption[]; confidence: number }
  | {
      kind: 'preview';
      summary: string;
      warnings: string[];
      renderKind: string;
      payload: unknown;
      requiresConfirmation: boolean;
      confidence: number;
      /** The mutation step to park + run on /confirm (when requiresConfirmation). */
      confirmStep?: PlanStep;
    }
  | { kind: 'query'; message: string; data: unknown }
  | { kind: 'rejected'; reason: string; message: string };

/** What a single executed mutation reports back. */
export interface ActionOutcome {
  entity: string;
  entityId: string;
  operation: 'create' | 'update' | 'delete';
  refKey?: string;
  data?: unknown;
}

export interface ExecutionResult {
  executedActions: Array<{ entity: string; entityId: string; operation: 'create' | 'update' | 'delete' }>;
  createdEntityIds: Record<string, string>;
  result: unknown;
}
