// ============================================================
// AI Command Workflow — shared types.
//
// The AI never executes and never decides. It returns ONE of five shapes; the
// program then validates, resolves records, gates permissions, confirms, and
// executes. These types are the contract between the LLM interpretation layer,
// the resolve/validate pass, the executor, and the HTTP boundary.
// ============================================================

export type DangerLevel = 'none' | 'low' | 'medium' | 'high';

/** A single planned step: a registered action name + its extracted data. */
export interface WorkflowStep {
  action: string;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Raw LLM output — validated against a discriminated union before it is trusted
// (see ai-command-workflow.schemas.ts). The AI must return exactly one `kind`.
// ---------------------------------------------------------------------------

export interface LlmWorkflowPlan {
  kind: 'workflow_plan';
  intent: string;
  confidence?: number;
  missingSlots?: string[];
  steps: WorkflowStep[];
  confirmationMessage?: string;
}
export interface LlmClarification {
  kind: 'clarification';
  intent?: string;
  confidence?: number;
  missingSlots?: string[];
  question: string;
}
export interface LlmQuery {
  kind: 'query';
  intent: string;
  confidence?: number;
  steps: WorkflowStep[];
}
export interface LlmRejected {
  kind: 'rejected';
  reason: string;
}
export type LlmInterpretation = LlmWorkflowPlan | LlmClarification | LlmQuery | LlmRejected;

// ---------------------------------------------------------------------------
// API result kinds (what /interpret, /confirm, /cancel return)
// ---------------------------------------------------------------------------

/** A record the user must choose between when a reference is ambiguous. */
export interface ClarificationOption {
  /** Which slot/reference this option resolves (e.g. "clientId", "projectId"). */
  slot: string;
  id: string;
  label: string;
}

/** Data is missing or a reference is ambiguous — nothing is executed. */
export interface ClarificationResult {
  kind: 'clarification';
  sessionId: string;
  intent: string | null;
  /** The question to show the user, in Arabic. */
  message: string;
  missingSlots: string[];
  options?: ClarificationOption[];
}

/** The command is understood and mutates data — confirmation required first. */
export interface ConfirmationPlan {
  kind: 'workflow_plan';
  sessionId: string;
  intent: string;
  confidence: number;
  requiresConfirmation: true;
  missingSlots: string[];
  steps: WorkflowStep[];
  confirmationMessage: string;
}

/** A read-only query/summary — executed immediately, no confirmation. */
export interface QueryResult {
  kind: 'query';
  sessionId: string;
  intent: string;
  message: string;
  data: unknown;
}

export interface ExecutedActionInfo {
  action: string;
  entity: string;
  entityId: string;
  operation: 'create' | 'update' | 'delete';
}

/** A confirmed plan executed successfully. */
export interface ExecutionResult {
  kind: 'execution';
  sessionId: string;
  intent: string;
  message: string;
  executedActions: ExecutedActionInfo[];
  /** entity-kind → id, e.g. { customer, contract, project }. */
  createdEntityIds: Record<string, string>;
  updatedEntityIds: Record<string, string>;
}

/** The command is not allowed, not understood, or outside the user's permissions. */
export interface RejectedResult {
  kind: 'rejected';
  sessionId: string | null;
  intent: string | null;
  /** Machine-readable reason code (audited). */
  reason: string;
  /** User-facing message, in Arabic. */
  message: string;
}

/** A pending plan was cancelled by the user. */
export interface CancellationResult {
  kind: 'cancelled';
  sessionId: string;
  message: string;
}

export type InterpretResult =
  | ClarificationResult
  | ConfirmationPlan
  | QueryResult
  | ExecutionResult
  | RejectedResult;

export type ConfirmResult = ExecutionResult | RejectedResult;

// ---------------------------------------------------------------------------
// Execution plumbing
// ---------------------------------------------------------------------------

/** References threaded between steps: existing ids resolved before confirmation,
 *  plus ids of records created during execution. Our plans are linear (at most
 *  one client + one contract + one project), so plan-level refs suffice. */
export interface PlanRefs {
  clientId?: string;
  contractId?: string;
  projectId?: string;
  materialId?: string;
  /** Resolved delete/mutate targets (e.g. "احذف آخر مصروف" → the last cost). */
  costId?: string;
  paymentId?: string;
  /** True when no existing client matched and the workflow must create one. */
  willCreateClient?: boolean;
}

/** The authenticated caller + their effective permissions, passed to executors. */
export interface ExecContext {
  userId: string;
  role: string;
  /** { userId, ipAddress?, userAgent? } — for AuditService.log. */
  actor: { userId: string; ipAddress?: string; userAgent?: string };
  /** Effective permission keys (OWNER resolves to all). */
  permissions: Set<string>;
}

/** What a single mutation step reports back to the executor. */
export interface StepOutcome {
  entity: string;
  entityId: string;
  operation: 'create' | 'update' | 'delete';
  /** Store the created id under this ref so later steps can consume it. */
  refKey?: keyof PlanRefs;
}

// ---------------------------------------------------------------------------
// Session state (in-memory, TTL-bounded)
// ---------------------------------------------------------------------------

/** A fully resolved plan parked in the session, awaiting /confirm. */
export interface StoredPlan {
  intent: string;
  confidence: number;
  steps: WorkflowStep[];
  confirmationMessage: string;
  /** Existing-entity ids resolved during the read-only pass before confirmation. */
  refs: PlanRefs;
  originalText: string;
}

export interface Session {
  sessionId: string;
  userId: string;
  pendingIntent: string | null;
  collectedSlots: Record<string, unknown>;
  missingSlots: string[];
  pendingPlan: StoredPlan | null;
  originalText: string;
  createdAt: number;
  expiresAt: number;
}
