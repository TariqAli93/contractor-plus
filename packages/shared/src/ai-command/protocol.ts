// ============================================================
// AI Command Workflow — wire protocol shared between the SPA and the backend.
//
// The backend returns exactly one of these result shapes from /interpret,
// /confirm, and /cancel; the frontend renders by `kind`.
// ============================================================

export interface AiWorkflowStep {
  action: string;
  data: Record<string, unknown>;
}

export interface AiClarificationOption {
  slot: string;
  id: string;
  label: string;
}

export interface AiClarificationResult {
  kind: 'clarification';
  sessionId: string;
  intent: string | null;
  message: string;
  missingSlots: string[];
  options?: AiClarificationOption[];
}

export interface AiConfirmationPlan {
  kind: 'workflow_plan';
  sessionId: string;
  intent: string;
  confidence: number;
  requiresConfirmation: true;
  missingSlots: string[];
  steps: AiWorkflowStep[];
  confirmationMessage: string;
}

export interface AiQueryResult {
  kind: 'query';
  sessionId: string;
  intent: string;
  message: string;
  data: unknown;
}

export interface AiExecutedActionInfo {
  action: string;
  entity: string;
  entityId: string;
  operation: 'create' | 'update' | 'delete';
}

export interface AiExecutionResult {
  kind: 'execution';
  sessionId: string;
  intent: string;
  message: string;
  executedActions: AiExecutedActionInfo[];
  createdEntityIds: Record<string, string>;
  updatedEntityIds: Record<string, string>;
}

export interface AiRejectedResult {
  kind: 'rejected';
  sessionId: string | null;
  intent: string | null;
  reason: string;
  message: string;
}

export interface AiCancellationResult {
  kind: 'cancelled';
  sessionId: string;
  message: string;
}

/** Any /interpret response. */
export type AiInterpretResult =
  | AiClarificationResult
  | AiConfirmationPlan
  | AiQueryResult
  | AiExecutionResult
  | AiRejectedResult;

/** Any /confirm response. */
export type AiConfirmResult = AiExecutionResult | AiRejectedResult;

/** Any /cancel response. */
export type AiCancelResult = AiCancellationResult | AiRejectedResult;

// ---------- request bodies ----------

export interface AiInterpretRequest {
  text: string;
  sessionId?: string;
}
export interface AiSessionRequest {
  sessionId: string;
}

// ---------- LLM settings (settings tab) ----------

export type AiLlmProvider = 'openai' | 'groq' | 'anthropic' | 'gemini' | 'openrouter';

export interface AiLlmSettingsView {
  enabled: boolean;
  provider: AiLlmProvider;
  model: string;
  timeoutMs: number;
  maxTokens: number;
  apiKeySet: boolean;
  effective: boolean;
}

export interface AiLlmTestConnectionResult {
  ok: boolean;
  provider: AiLlmProvider;
  model: string;
  latencyMs?: number;
  error?: string;
}

// ---------- proactive insights (shown when the console opens) ----------

export interface AiInsights {
  /** False when the user lacks reports.read — only a neutral greeting is shown. */
  hasReports: boolean;
  message: string;
  overduePayments: number;
  delayedProjects: number;
  monthlyProfit: string | null;
  topOverdueCustomer: { customerName: string | null; amount: string } | null;
}
