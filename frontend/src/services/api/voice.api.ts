import { apiGet, apiPatch, apiPost } from './client';
import type {
  DecisionRequest,
  InterpretRequest,
  VoiceTurnResponse,
} from '@contractor-plus/shared';

// UI-safe view of the LLM settings — mirrors the backend VoiceLlmSettingsView.
// The API key is NEVER included; `apiKeySet` tells the UI a key is on file.
export interface VoiceAiSettings {
  enabled: boolean;
  provider: 'anthropic' | 'openai';
  model: string;
  timeoutMs: number;
  maxTokens: number;
  apiKeySet: boolean;
  /** enabled AND a key present → the AI actually engages. */
  effective: boolean;
}

export interface VoiceAiSettingsUpdate {
  enabled?: boolean;
  provider?: 'anthropic' | 'openai';
  model?: string;
  timeoutMs?: number;
  maxTokens?: number;
  /** A new key to store (encrypted server-side). Omit/empty = keep existing. */
  apiKey?: string;
  /** Explicitly remove the stored key. */
  clearApiKey?: boolean;
}

export interface VoiceAiTestResult {
  ok: boolean;
  provider: string;
  model: string;
  error?: string;
}

export interface VoiceAiTestInput {
  provider?: 'anthropic' | 'openai';
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
}

export const voiceApi = {
  interpret: (body: InterpretRequest): Promise<VoiceTurnResponse> =>
    apiPost('/voice/interpret', body),

  decide: (body: DecisionRequest): Promise<VoiceTurnResponse> =>
    apiPost('/voice/decision', body),

  // ----- LLM (AI) settings — Settings → المساعد الذكي -----
  getSettings: (): Promise<VoiceAiSettings> => apiGet('/voice/settings'),

  updateSettings: (body: VoiceAiSettingsUpdate): Promise<VoiceAiSettings> =>
    apiPatch('/voice/settings', body),

  testConnection: (body: VoiceAiTestInput): Promise<VoiceAiTestResult> =>
    apiPost('/voice/settings/test', body),
};
