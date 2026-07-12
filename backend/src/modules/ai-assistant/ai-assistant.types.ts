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
