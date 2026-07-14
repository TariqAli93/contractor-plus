// ai-assistant module DTOs (Phase 1: status, Phase 2: report narratives).

export type AiDisabledReason = 'NO_API_KEY' | 'NO_DEFAULT_MODEL';

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
  managedByEnv: boolean;
}

export interface AiPriceSource {
  name: string;
  url: string;
  region?: string;
}

export interface AiSettings {
  enabled: boolean;
  reason?: AiDisabledReason | 'SYSTEM_DISABLED';
  systemEnabled: boolean;
  features: Record<AiFeatureKey, boolean>;
  modelDefault?: string;
  modelHeavy?: string;
  modelAllowlist: string[];
  keyManagementEnabled: boolean;
  key: AiKeyInfo;
  monthlyTokenBudget: number | null;
  usage: AiMonthlyUsage;
  sources: AiPriceSource[];
  syncIntervalHours: number | null;
}

/** PUT /ai/settings — every field optional (partial update). */
export interface UpdateAiSettingsPayload {
  systemEnabled?: boolean;
  features?: Partial<Record<AiFeatureKey, boolean>>;
  modelDefault?: string | null;
  modelHeavy?: string | null;
  monthlyTokenBudget?: number | null;
  materialPriceSources?: AiPriceSource[];
}
