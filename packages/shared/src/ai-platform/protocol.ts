// ============================================================
// AI Operating Platform — wire protocol shared between the SPA and the backend.
//
// Generic and tool-agnostic: every AI capability flows through one session +
// message pipeline. `POST /ai/session/:id/message` and `/confirm` return one of
// the discriminated `PlatformMessageResult` shapes; the frontend renders by
// `kind`, and a `preview` result's tool-specific body is rendered by the per-tool
// renderer registry keyed on `renderKind`. Money/quantity values cross the wire
// as fixed-precision STRINGS — the backend does all computation.
//
// Result types are `Platform*`-prefixed to stay distinct from the legacy
// ai-command protocol (`Ai*Result`), which merges into the platform in Phase 3.
// ============================================================

export type AiSessionStatus =
  | 'ACTIVE'
  | 'AWAITING_CONFIRMATION'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'FAILED';

export type AiMessageRole = 'USER' | 'ASSISTANT' | 'SYSTEM';

export type AiMessageKind =
  | 'command'
  | 'answer'
  | 'clarification'
  | 'plan'
  | 'preview'
  | 'query'
  | 'execution'
  | 'rejected'
  | 'error';

// ---------- session / message read models ----------

export interface AiSessionSummary {
  id: string;
  title: string | null;
  status: AiSessionStatus;
  activeTool: string | null;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

export interface AiMessageView {
  id: string;
  role: AiMessageRole;
  kind: AiMessageKind;
  content: string;
  toolName: string | null;
  confidence: number | null;
  createdAt: string;
}

export interface AiSessionView extends AiSessionSummary {
  messages: AiMessageView[];
  workingState: unknown | null;
  pendingSummary: string | null;
}

// ---------- message / confirm results (discriminated by `kind`) ----------

export interface PlatformRefOption {
  slot: string;
  id: string;
  label: string;
}

/** The pipeline needs more info before it can act. */
export interface PlatformClarificationResult {
  kind: 'clarification';
  sessionId: string;
  question: string;
  missing: string[];
  options?: PlatformRefOption[];
  confidence: number;
}

/** A resolved plan awaiting confirmation. `payload` is tool-specific and rendered
 *  by the renderer registered for `renderKind`. */
export interface PlatformPreviewResult {
  kind: 'preview';
  sessionId: string;
  toolName: string;
  renderKind: string;
  summary: string;
  warnings: string[];
  payload: unknown;
  requiresConfirmation: boolean;
  confidence: number;
}

/** A read-only query answered immediately (no confirmation). */
export interface PlatformQueryResult {
  kind: 'query';
  sessionId: string;
  toolName: string | null;
  message: string;
  data: unknown;
}

export interface PlatformExecutedActionInfo {
  entity: string;
  entityId: string;
  operation: 'create' | 'update' | 'delete';
}

/** A confirmed plan executed successfully. */
export interface PlatformExecutionResult {
  kind: 'execution';
  sessionId: string;
  toolName: string | null;
  message: string;
  executedActions: PlatformExecutedActionInfo[];
  createdEntityIds: Record<string, string>;
  result: unknown;
}

/** Out of scope, not understood, or permission denied — a valid, understood "no". */
export interface PlatformRejectedResult {
  kind: 'rejected';
  sessionId: string | null;
  reason: string;
  message: string;
}

/** A deterministic reply produced WITHOUT the LLM by the pre-router — a
 *  capability/help listing, a greeting, or a status restatement. Consumes no
 *  usage quota and writes no execution-audit row. */
export interface PlatformAnswerResult {
  kind: 'answer';
  sessionId: string;
  message: string;
  /** Example commands the UI may render as quick chips. */
  suggestions?: string[];
}

/** A clean infrastructure failure — LLM timeout, usage quota exceeded, or the AI
 *  provider being unavailable. Distinct from `rejected`: the request was
 *  understood but could not be served right now. `message` is user-facing Arabic. */
export interface PlatformErrorResult {
  kind: 'error';
  sessionId: string | null;
  reason: string;
  message: string;
}

export type PlatformMessageResult =
  | PlatformAnswerResult
  | PlatformClarificationResult
  | PlatformPreviewResult
  | PlatformQueryResult
  | PlatformExecutionResult
  | PlatformRejectedResult
  | PlatformErrorResult;

export type PlatformConfirmResult = PlatformExecutionResult | PlatformRejectedResult | PlatformErrorResult;

export interface PlatformCancelResult {
  kind: 'cancelled';
  sessionId: string;
  message: string;
}

// ---------- tool discovery (GET /ai/tools) ----------

export interface AiToolActionInfo {
  name: string;
  description: string;
  kind: 'query' | 'mutation';
  requiredPermissions: string[];
}

export interface AiToolInfo {
  name: string;
  displayName: string;
  renderKind: string;
  permissionModule: string;
  actions: AiToolActionInfo[];
}

// ---------- unified audit trail (GET /ai/audit) ----------

/** One AiExecution row, projected for the audit panel. */
export interface AiExecutionView {
  id: string;
  sessionId: string | null;
  userId: string;
  userName: string | null;
  toolName: string | null;
  originalRequest: string;
  transactionResult: string;
  confidence: number | null;
  failedReason: string | null;
  executedActions: unknown;
  createdAt: string;
}

export interface AiExecutionListResult {
  items: AiExecutionView[];
  total: number;
}

/** Filters accepted by GET /ai/audit (all optional). */
export interface AiExecutionQuery {
  userId?: string;
  toolName?: string;
  transactionResult?: string;
  /** ISO date-time bounds. */
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

// ---------- request bodies ----------

export interface AiOpenSessionRequest {
  title?: string;
}
export interface AiMessageRequest {
  text: string;
}
