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
  | 'clarification'
  | 'plan'
  | 'preview'
  | 'query'
  | 'execution'
  | 'rejected';

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

/** Out of scope, not understood, LLM failure, or permission denied. */
export interface PlatformRejectedResult {
  kind: 'rejected';
  sessionId: string | null;
  reason: string;
  message: string;
}

export type PlatformMessageResult =
  | PlatformClarificationResult
  | PlatformPreviewResult
  | PlatformQueryResult
  | PlatformExecutionResult
  | PlatformRejectedResult;

export type PlatformConfirmResult = PlatformExecutionResult | PlatformRejectedResult;

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

// ---------- request bodies ----------

export interface AiOpenSessionRequest {
  title?: string;
}
export interface AiMessageRequest {
  text: string;
}
