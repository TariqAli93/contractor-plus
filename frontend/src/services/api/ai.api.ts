import { apiGet, apiPost } from './client';
import type { AiReportType, AiStatus, ReportNarrative } from '@/types/ai';

// Narrative generation waits on the model round-trip (backend allows 30s) —
// override the client's default 15s so the browser doesn't give up first.
const NARRATIVE_TIMEOUT_MS = 60_000;

export const aiApi = {
  status: (): Promise<AiStatus> => apiGet('/ai/status'),

  reportNarrative: (
    reportType: AiReportType,
    filters: Record<string, unknown> = {},
  ): Promise<ReportNarrative> =>
    apiPost(`/ai/reports/${reportType}/narrative`, filters, { timeout: NARRATIVE_TIMEOUT_MS }),
};
