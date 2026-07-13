import type { AiApprovalState, AiOperationType } from '@prisma/client';
import type { AiDisabledReason } from '../../lib/ai/ai-config.js';

/**
 * Payload of GET /ai/status — safe to expose to the SPA. Never carries the
 * API key; model slugs are not secrets (they appear in the settings UI).
 */
export interface AiStatusDto {
  enabled: boolean;
  /** Present only when disabled — lets the UI say WHY (no key vs. no model). */
  reason?: AiDisabledReason;
  modelDefault?: string;
  modelHeavy?: string;
  monthlyTokenBudget?: number;
}

/**
 * Input for one AiRequestLog row — a governance SUMMARY of a provider call.
 * Deliberately has no field for prompt/response text (binding rule #4).
 */
export interface CreateAiRequestLogInput {
  userId: string;
  operationType: AiOperationType;
  modelUsed: string;
  sourceModules: string[];
  recordIds: string[];
  tokensPrompt: number;
  tokensCompletion: number;
  costUsd?: string;
  outputSummary: string;
  approvalState?: AiApprovalState;
}

// ----- Phase 4: save-guards -----

export type GuardWarningSeverity = 'info' | 'warning';

export interface GuardWarning {
  code: string;
  severity: GuardWarningSeverity;
  /** 'rule' = deterministic check; 'ai' = model-suggested sanity note. */
  source: 'rule' | 'ai';
  message: string;
}

/**
 * Advisory ONLY. The guard endpoint never blocks anything — existing
 * programmatic validation in costs/payments stays authoritative, and the
 * frontend saves regardless of what is returned here.
 */
export interface GuardResult {
  warnings: GuardWarning[];
  /** false when AI is disabled or the model layer failed (rules still ran). */
  aiChecked: boolean;
}

// ----- Phase 4: recommendations & suggestions -----

export type RecommendationKind =
  | 'NEGATIVE_MARGIN'
  | 'LOW_MARGIN'
  | 'SPEND_WITHOUT_PROGRESS'
  | 'REPEAT_LATE_CUSTOMER'
  | 'MATERIAL_PRICE_RISE';

export type RecommendationSeverity = 'info' | 'warning' | 'critical';

export interface RecommendationItem {
  /** Stable finding id: `<kind>:<entityId>` — also the LLM join key. */
  id: string;
  kind: RecommendationKind;
  severity: RecommendationSeverity;
  title: string;
  detail: string;
  projectId?: string;
  projectName?: string;
  contractId?: string;
  contractNumber?: string;
  customerId?: string;
  customerName?: string;
  materialId?: string;
  materialName?: string;
  /** true ⇒ a PENDING suggestion exists and can be applied via approval. */
  applicable: boolean;
  /** AiRequestLog row id of the PENDING suggestion (when applicable). */
  suggestionId?: string;
  /** 1 (low) … 5 (urgent) — model-assigned when enrichment ran. */
  aiPriority?: number;
  aiAdvice?: string;
}

export interface RecommendationsResult {
  items: RecommendationItem[];
  aiEnriched: boolean;
  modelUsed?: string;
  generatedAt: string;
}

export interface ApplySuggestionResult {
  suggestionId: string;
  approvalState: AiApprovalState;
  changeOrder: { id: string; number: number; amount: string };
}
