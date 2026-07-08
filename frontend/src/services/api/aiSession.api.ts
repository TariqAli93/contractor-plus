import { apiGet, apiPost } from './client';
import type {
  AiSessionSummary,
  AiSessionView,
  AiToolInfo,
  PlatformCancelResult,
  PlatformConfirmResult,
  PlatformMessageResult,
} from '@contractor-plus/shared';

// Thin, typed wrappers over the AI Operating Platform endpoints (mounted at
// /api/v1/ai). Every AI capability flows through one session + message pipeline;
// the caller renders the discriminated `Platform*Result` by `kind`. Mirrors the
// module-API style of aiCommand.api.ts / estimationTemplates.api.ts.
const BASE = '/ai';

export const aiSessionApi = {
  /** Open a fresh session (optionally titled). */
  openSession: (title?: string): Promise<AiSessionSummary> =>
    apiPost(`${BASE}/session`, { title }),

  /** Send a natural-language turn; the backend answers with one of the
   *  discriminated message results (clarification / preview / query /
   *  execution / rejected). */
  sendMessage: (sessionId: string, text: string): Promise<PlatformMessageResult> =>
    apiPost(`${BASE}/session/${sessionId}/message`, { text }),

  /** Confirm the pending preview → execution (or rejected). No body. */
  confirm: (sessionId: string): Promise<PlatformConfirmResult> =>
    apiPost(`${BASE}/session/${sessionId}/confirm`),

  /** Cancel the active session/pending plan. */
  cancel: (sessionId: string): Promise<PlatformCancelResult> =>
    apiPost(`${BASE}/session/${sessionId}/cancel`),

  /** Full session read model (messages + working state). */
  getSession: (sessionId: string): Promise<AiSessionView> =>
    apiGet(`${BASE}/session/${sessionId}`),

  /** Recent sessions for this user. */
  listSessions: (): Promise<AiSessionSummary[]> => apiGet(`${BASE}/sessions`),

  /** Tool discovery (capabilities + required permissions). */
  listTools: (): Promise<AiToolInfo[]> => apiGet(`${BASE}/tools`),
};
