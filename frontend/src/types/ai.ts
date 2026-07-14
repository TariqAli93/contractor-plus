// ai-assistant module DTOs (Phase 1: status, Phase 2: report narratives).

export type AiDisabledReason = 'NOT_CONFIGURED' | 'NO_DEFAULT_MODEL' | 'SYSTEM_DISABLED';

export interface AiStatus {
  enabled: boolean;
  /** Present only when disabled — tells the UI WHY. */
  reason?: AiDisabledReason;
  modelDefault?: string;
  modelHeavy?: string;
  monthlyTokenBudget?: number;
}

export type AiReportType =
  | 'cash-flow'
  | 'delayed-projects'
  | 'overdue-payments'
  | 'project-profitability';

export interface ReportNarrative {
  reportType: AiReportType;
  narrative: string;
  factors: string[];
  modelUsed: string;
  generatedAt: string;
}

// ----- Phase 4: save-guards -----

export interface GuardWarning {
  code: string;
  severity: 'info' | 'warning';
  source: 'rule' | 'ai';
  message: string;
}

/** Advisory only — the caller saves regardless of what comes back. */
export interface GuardResult {
  warnings: GuardWarning[];
  aiChecked: boolean;
}

// ----- Phase 4: recommendations & suggestions -----

export type RecommendationKind =
  | 'NEGATIVE_MARGIN'
  | 'LOW_MARGIN'
  | 'SPEND_WITHOUT_PROGRESS'
  | 'REPEAT_LATE_CUSTOMER'
  | 'MATERIAL_PRICE_RISE';

export interface RecommendationItem {
  id: string;
  kind: RecommendationKind;
  severity: 'info' | 'warning' | 'critical';
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
  applicable: boolean;
  suggestionId?: string;
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
  approvalState: string;
  changeOrder: { id: string; number: number; amount: string };
}

// ----- Phase 5: material reference prices -----

export interface ReferencePrice {
  materialId: string;
  price: string;
  currency: string;
  source: string;
  region: string | null;
  referenceUpdatedAt: string;
  fetchedAt: string;
}

export interface MaterialPriceChange {
  materialId: string;
  materialName: string;
  unit: string;
  currency: string;
  currentPrice: string;
  previousPrice: string;
  changePercent: number;
  direction: 'up' | 'down';
  source: string;
  referenceUpdatedAt: string;
}

export interface SyncPricesResult {
  enabled: boolean;
  sources: number;
  fetched: number;
  matched: number;
  inserted: number;
  skippedUnmatched: number;
  errors: { source: string; message: string }[];
  ranAt: string;
}

// ----- Phase 6: governance / settings -----

export interface AiOperationUsage {
  operationType: string;
  tokens: number;
  count: number;
}

export interface AiMonthlyUsage {
  periodStart: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestCount: number;
  budget: number | null;
  remaining: number | null;
  overBudget: boolean;
  byOperation: AiOperationUsage[];
}

// Phase 2.5 — control panel.
export const AI_FEATURE_KEYS = [
  'report_narrative',
  'nl_query',
  'save_guard',
  'recommendations',
  'chat',
] as const;
export type AiFeatureKey = (typeof AI_FEATURE_KEYS)[number];

export type AiKeyStatus = 'set_env' | 'set_db' | 'unset';

export interface AiKeyInfo {
  status: AiKeyStatus;
  lastFour?: string;
  validatedAt?: string;
  /** Models the key could reach at validation time (DB key only). */
  modelCount?: number | null;
  /** true when the resolved key is the env FALLBACK (no DB key set). */
  managedByEnv: boolean;
}

export interface AiPriceSource {
  name: string;
  url: string;
  region?: string;
}

/** One selectable OpenRouter model (mirrors the backend/shared DTO). */
export interface AiModelListItem {
  id: string;
  name: string;
  provider: string;
  displayName: string;
  description?: string;
  isFree: boolean;
  contextLength: number | null;
  promptPricePerMillion: number | null;
  completionPricePerMillion: number | null;
  supportsTools: boolean;
  supportsStructuredOutput: boolean;
}

/** GET /ai/models — the live, key-scoped catalogue. */
export interface AiModelsResponse {
  models: AiModelListItem[];
  stale: boolean;
}

/** PUT /ai/settings/openrouter-key result — never the raw key. */
export interface KeySaveResult {
  configured: true;
  maskedKey: string;
  modelCount: number;
}

export interface AiSettings {
  provider: 'openrouter';
  configured: boolean;
  enabled: boolean;
  reason?: AiDisabledReason;
  systemEnabled: boolean;
  features: Record<AiFeatureKey, boolean>;
  modelDefault?: string;
  modelHeavy?: string;
  modelCount: number | null;
  keyManagementEnabled: boolean;
  key: AiKeyInfo;
  monthlyTokenBudget: number | null;
  usage: AiMonthlyUsage;
  sources: AiPriceSource[];
  syncIntervalHours: number | null;
}

/** PUT /ai/settings — every field optional (partial update). Models NOT here. */
export interface UpdateAiSettingsPayload {
  systemEnabled?: boolean;
  features?: Partial<Record<AiFeatureKey, boolean>>;
  monthlyTokenBudget?: number | null;
  materialPriceSources?: AiPriceSource[];
}

/** PUT /ai/settings/models — the chosen slugs (validated server-side). */
export interface UpdateModelsPayload {
  defaultModel: string;
  heavyModel?: string | null;
}

// ----- Phase 7: chat -----

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolReportType?: string;
  createdAt: string;
}

export interface ChatThreadSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatThread extends ChatThreadSummary {
  messages: ChatMessage[];
}

export interface ChatSendResult {
  threadId: string;
  title: string;
  message: ChatMessage;
}
