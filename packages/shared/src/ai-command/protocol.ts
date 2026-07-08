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

// OpenRouter is the app's single AI gateway — provider is fixed.
export type AiLlmProvider = 'openrouter';

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

// ---------- OpenRouter model discovery (safe, frontend-facing DTO) ----------

/** A single OpenRouter model, projected to only the fields the UI needs. The
 *  backend fetches these from OpenRouter's GET /models and caches them; the
 *  frontend never talks to OpenRouter directly. */
export interface OpenRouterModel {
  /** Vendor-prefixed id used as the `model` value, e.g. "openai/gpt-4o-mini". */
  id: string;
  name: string;
  description?: string;
  /** Max context window in tokens, when known. */
  contextLength: number | null;
  /** Per-token USD prices as strings (OpenRouter reports strings). */
  pricing: {
    prompt: string | null;
    completion: string | null;
    request: string | null;
    image: string | null;
  } | null;
  /** e.g. ["text","image"]. */
  inputModalities: string[];
  /** e.g. ["text"]. */
  outputModalities: string[];
  /** OpenAI-style parameter names the model supports, e.g. ["tools","temperature"]. */
  supportedParameters: string[];
  /** True when prompt+completion pricing are both zero. */
  isFree: boolean;
}

/** Capability filters accepted by GET /ai-command/models (all optional). */
export interface OpenRouterModelFilter {
  /** Require this input modality (e.g. "image" for vision models). */
  input?: string;
  /** Require this output modality (e.g. "text"). */
  output?: string;
  /** Require support for tool/function calling. */
  tools?: boolean;
  /** Minimum context window in tokens. */
  minContext?: number;
  /** Only models whose prompt price ≤ this (USD per token). */
  maxPromptPrice?: number;
  /** Only free models (zero prompt+completion price). */
  free?: boolean;
  /** Case-insensitive substring match on id/name. */
  search?: string;
}

export interface OpenRouterModelsResult {
  models: OpenRouterModel[];
  /** True when served from cache because a live fetch failed. */
  stale: boolean;
  /** ISO timestamp of the data's origin fetch, when known. */
  fetchedAt: string | null;
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
