import { apiGet, apiPatch, apiPost } from './client';
import type {
  AiCancelResult,
  AiConfirmResult,
  AiInsights,
  AiInterpretResult,
  AiLlmSettingsView,
  AiLlmTestConnectionResult,
  OpenRouterModelFilter,
  OpenRouterModelsResult,
} from '@contractor-plus/shared';

// OpenRouter is the single provider — settings carry no provider field anymore.
export interface AiLlmSettingsUpdate {
  enabled?: boolean;
  model?: string;
  timeoutMs?: number;
  maxTokens?: number;
  apiKey?: string;
  clearApiKey?: boolean;
}

export interface AiLlmTestInput {
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
}

function toQuery(filter: OpenRouterModelFilter): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filter)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const aiCommandApi = {
  interpret: (text: string, sessionId?: string): Promise<AiInterpretResult> =>
    apiPost('/ai-command/interpret', { text, sessionId }),
  confirm: (sessionId: string): Promise<AiConfirmResult> =>
    apiPost('/ai-command/confirm', { sessionId }),
  cancel: (sessionId: string): Promise<AiCancelResult> =>
    apiPost('/ai-command/cancel', { sessionId }),

  getInsights: (): Promise<AiInsights> => apiGet('/ai-command/insights'),

  getSettings: (): Promise<AiLlmSettingsView> => apiGet('/ai-command/settings'),
  updateSettings: (input: AiLlmSettingsUpdate): Promise<AiLlmSettingsView> =>
    apiPatch('/ai-command/settings', input),
  testConnection: (input: AiLlmTestInput): Promise<AiLlmTestConnectionResult> =>
    apiPost('/ai-command/settings/test', input),

  listModels: (filter: OpenRouterModelFilter = {}): Promise<OpenRouterModelsResult> =>
    apiGet(`/ai-command/models${toQuery(filter)}`),
};
