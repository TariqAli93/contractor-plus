import { apiDelete, apiGet, apiPost, apiPut } from './client';
import type {
  AiReportType,
  AiSettings,
  AiStatus,
  ApplySuggestionResult,
  ChatSendResult,
  ChatThread,
  ChatThreadSummary,
  GuardResult,
  MaterialPriceChange,
  RecommendationsResult,
  ReferencePrice,
  ReportNarrative,
  SyncPricesResult,
  UpdateAiSettingsPayload,
} from '@/types/ai';

// Model round-trips can exceed the client's default 15s (backend allows 30s
// per provider call, and recommendations may chain a heavy model) — give the
// AI endpoints their own generous timeouts so the browser doesn't give up
// first.
const NARRATIVE_TIMEOUT_MS = 60_000;
const RECOMMENDATIONS_TIMEOUT_MS = 90_000;
const GUARD_TIMEOUT_MS = 45_000;

export const aiApi = {
  status: (): Promise<AiStatus> => apiGet('/ai/status'),

  settings: (): Promise<AiSettings> => apiGet('/ai/settings'),

  updateSettings: (payload: UpdateAiSettingsPayload): Promise<AiSettings> =>
    apiPut('/ai/settings', payload),

  // The key round-trips through a live OpenRouter validation on the server —
  // allow generous time. The raw key is sent once and never held after.
  setApiKey: (apiKey: string): Promise<AiSettings> =>
    apiPut('/ai/settings/api-key', { apiKey }, { timeout: 30_000 }),

  clearApiKey: (): Promise<AiSettings> => apiDelete('/ai/settings/api-key'),

  // Chat — the send waits on 1-2 model round-trips (tool + compose).
  chatSend: (text: string, threadId: string | null): Promise<ChatSendResult> =>
    apiPost('/ai/chat', { text, threadId }, { timeout: 90_000 }),

  chatThreads: (): Promise<{ items: ChatThreadSummary[] }> => apiGet('/ai/chat/threads'),

  chatThread: (threadId: string): Promise<ChatThread> => apiGet(`/ai/chat/threads/${threadId}`),

  chatDeleteThread: (threadId: string): Promise<void> => apiDelete(`/ai/chat/threads/${threadId}`),

  reportNarrative: (
    reportType: AiReportType,
    filters: Record<string, unknown> = {},
  ): Promise<ReportNarrative> =>
    apiPost(`/ai/reports/${reportType}/narrative`, filters, { timeout: NARRATIVE_TIMEOUT_MS }),

  guardCost: (payload: Record<string, unknown>): Promise<GuardResult> =>
    apiPost('/ai/guard/cost', payload, { timeout: GUARD_TIMEOUT_MS }),

  guardPayment: (payload: Record<string, unknown>): Promise<GuardResult> =>
    apiPost('/ai/guard/payment', payload, { timeout: GUARD_TIMEOUT_MS }),

  recommendations: (): Promise<RecommendationsResult> =>
    apiGet('/ai/recommendations', { timeout: RECOMMENDATIONS_TIMEOUT_MS }),

  applySuggestion: (id: string): Promise<ApplySuggestionResult> =>
    apiPost(`/ai/suggestions/${id}/apply`),

  rejectSuggestion: (id: string): Promise<{ suggestionId: string; approvalState: string }> =>
    apiPost(`/ai/suggestions/${id}/reject`),

  materialReferencePrice: (materialId: string): Promise<ReferencePrice | null> =>
    apiGet(`/ai/materials/${materialId}/reference-price`),

  materialPriceChanges: (): Promise<{ items: MaterialPriceChange[] }> =>
    apiGet('/ai/materials/price-changes'),

  // Fetch loop can be slow (multiple external sources) — allow generous time.
  syncMaterialPrices: (): Promise<SyncPricesResult> =>
    apiPost('/ai/materials/sync-prices', undefined, { timeout: 90_000 }),
};
