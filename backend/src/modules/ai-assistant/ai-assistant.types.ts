import type { AiApprovalState, AiOperationType } from '@prisma/client';
import type { AiFeature, AiModelListItem } from '@contractor-plus/shared';
import type { AiDisabledReason } from '../../lib/ai/ai-config.js';
import type { MaterialPriceSource } from '../../config/app-config.js';
import type { PendingActionDto } from './tools/ai-tool.types.js';

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

// ----- Phase 6: governance / usage -----

export interface AiOperationUsage {
  operationType: string;
  tokens: number;
  count: number;
}

/** Current-calendar-month token usage from AiRequestLog (governance view). */
export interface AiMonthlyUsage {
  /** First instant of the current calendar month (UTC), ISO. */
  periodStart: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestCount: number;
  /** Configured ceiling; null → unlimited. */
  budget: number | null;
  /** budget - totalTokens (never below 0); null when unlimited. */
  remaining: number | null;
  overBudget: boolean;
  byOperation: AiOperationUsage[];
}

// ----- Phase 2.5: control panel -----

/** Where the resolved OpenRouter key comes from (never the key itself). */
export type AiKeyStatus = 'set_env' | 'set_db' | 'unset';

export interface AiKeyInfo {
  status: AiKeyStatus;
  /** Last 4 chars for masked display (`••••••{lastFour}`). Never the key. */
  lastFour?: string;
  /** ISO — when the DB key was last confirmed valid against OpenRouter. */
  validatedAt?: string;
  /** Models the key could reach at validation time (DB key only). */
  modelCount?: number | null;
  /**
   * true when the resolved key comes from the env/service.json FALLBACK (no DB
   * key is set). The DB key is primary; the panel can still set one to take over.
   */
  managedByEnv: boolean;
}

/**
 * GET /ai/settings payload (ai.use to read). A control panel: DB-backed
 * toggles/budget (DB wins over env) plus the selected models and the key
 * STATUS. Models are chosen from the LIVE OpenRouter list (fetched separately
 * via GET /ai/models), so no static allow-list is exposed here. The raw key is
 * NEVER included — only `key.lastFour`/status.
 */
export interface AiSettingsDto {
  provider: 'openrouter';
  /** true once a key (DB or env fallback) is configured. */
  configured: boolean;
  /** Resolved overall availability (system on AND a key AND a default model). */
  enabled: boolean;
  reason?: AiDisabledReason;
  /** Master switch (DB). */
  systemEnabled: boolean;
  /** Per-feature toggles (DB), defaulting to true. */
  features: Record<AiFeature, boolean>;
  modelDefault?: string;
  modelHeavy?: string;
  /** Models reachable by the current key (from the last validation); null if unknown. */
  modelCount: number | null;
  /** false when ENCRYPTION_KEY is absent/short → DB key storage is disabled. */
  keyManagementEnabled: boolean;
  key: AiKeyInfo;
  monthlyTokenBudget: number | null;
  usage: AiMonthlyUsage;
  /** Editable price sources (DB wins over env). URLs included for editing. */
  sources: MaterialPriceSource[];
  syncIntervalHours: number | null;
}

/** Result of PUT /ai/settings/openrouter-key — never the raw key. */
export interface KeySaveResult {
  configured: true;
  /** `••••••{lastFour}` for immediate display. */
  maskedKey: string;
  /** Models the key can reach (from the live fetch done during validation). */
  modelCount: number;
}

/** Response of GET /ai/models — the live, key-scoped catalogue. */
export interface AiModelsResponse {
  models: AiModelListItem[];
  /** true when a refresh failed and a previously-cached list is served. */
  stale: boolean;
}

// ----- Phase 2.5: repository inputs -----

export interface SaveCredentialInput {
  ciphertext: string;
  iv: string;
  authTag: string;
  lastFour: string;
  validatedAt?: Date | null;
  /** Models reachable at validation time (drives the panel hint). */
  validatedModelCount?: number | null;
  createdById?: string | null;
}

export interface UpdateAiSettingInput {
  systemEnabled?: boolean;
  features?: Record<string, boolean>;
  modelDefault?: string | null;
  modelHeavy?: string | null;
  monthlyTokenBudget?: number | null;
  materialPriceSources?: MaterialPriceSource[];
  updatedById?: string | null;
}

// ----- Phase 7: chat -----

export type ChatRole = 'user' | 'assistant';

export interface ChatMessageDto {
  id: string;
  role: ChatRole;
  content: string;
  /** The report the assistant queried this turn, when it used the tool. */
  toolReportType?: string;
  createdAt: string;
}

export interface ChatThreadSummaryDto {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatThreadDto extends ChatThreadSummaryDto {
  messages: ChatMessageDto[];
}

/** Result of sending one message — the assistant reply + the (maybe new) thread. */
export interface ChatSendResult {
  threadId: string;
  title: string;
  message: ChatMessageDto;
  /**
   * Writes the assistant proposed this turn (create_*, update_app_settings).
   * Empty unless the model called a write tool. A write NEVER runs here — each
   * pending action is executed only through an explicit POST /ai/actions/:id/confirm.
   */
  pendingActions: PendingActionDto[];
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

// ----- Phase 5: material reference prices -----

/** One row appended to MaterialReferencePrice (repository input). */
export interface InsertReferencePriceInput {
  materialId: string;
  /** Stored in the source's ORIGINAL currency — never pre-converted (rule #5). */
  referencePrice: string;
  referenceCurrency: string;
  referenceSource: string;
  referenceRegion?: string | null;
  referenceUpdatedAt: Date;
}

/** Latest reference price for a material — form/column display DTO. */
export interface ReferencePriceDto {
  materialId: string;
  price: string;
  currency: string;
  source: string;
  region: string | null;
  /** When the SOURCE last updated it (drives the staleness hint). */
  referenceUpdatedAt: string;
  /** When we fetched it. */
  fetchedAt: string;
}

/** A detected reference-price movement for the dashboard card. */
export interface MaterialPriceChangeDto {
  materialId: string;
  materialName: string;
  unit: string;
  currency: string;
  currentPrice: string;
  previousPrice: string;
  /** Signed percentage (current vs previous, same currency only). */
  changePercent: number;
  direction: 'up' | 'down';
  source: string;
  referenceUpdatedAt: string;
}

/** Result of a sync run — summary only, safe to surface and audit. */
export interface SyncPricesResult {
  /** false when no sources are configured (safe no-op). */
  enabled: boolean;
  sources: number;
  /** Price rows received across all sources. */
  fetched: number;
  /** Rows matched to a known material. */
  matched: number;
  /** Rows appended (== matched; kept distinct for clarity). */
  inserted: number;
  /** Rows dropped because no material matched the name. */
  skippedUnmatched: number;
  errors: { source: string; message: string }[];
  ranAt: string;
}
