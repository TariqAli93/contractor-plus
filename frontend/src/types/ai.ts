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
