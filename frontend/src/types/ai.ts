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
