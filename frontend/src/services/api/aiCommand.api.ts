import { apiGet, apiPatch, apiPost } from './client';
import type {
  AiCancelResult,
  AiConfirmResult,
  AiInsights,
  AiInterpretResult,
  AiLlmProvider,
  AiLlmSettingsView,
  AiLlmTestConnectionResult,
} from '@contractor-plus/shared';

export interface AiLlmSettingsUpdate {
  enabled?: boolean;
  provider?: AiLlmProvider;
  model?: string;
  timeoutMs?: number;
  maxTokens?: number;
  apiKey?: string;
  clearApiKey?: boolean;
}

export interface AiLlmTestInput {
  provider?: AiLlmProvider;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
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
};
