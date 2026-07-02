// ============================================================
// Voice assistant store — the frontend half of the turn state machine.
//
// Holds the session id, the current dialog status, the pending confirmation, and
// a small transcript history. It calls the backend and returns the raw
// VoiceTurnResponse so the VIEW performs side effects (navigation, toast, TTS).
// The store stays free of router/DOM concerns (testable, single-responsibility).
// ============================================================

import { defineStore } from 'pinia';
import { ref } from 'vue';
import { voiceApi } from '@/services/api/voice.api';
import type {
  ConfirmationView,
  VoiceTurnResponse,
} from '@contractor-plus/shared';

export type VoiceStatus = 'idle' | 'processing' | 'clarifying' | 'confirming';

export interface VoiceTurn {
  role: 'user' | 'assistant';
  text: string;
}

export const useVoiceStore = defineStore('voice', () => {
  const sessionId = ref<string | undefined>(undefined);
  const status = ref<VoiceStatus>('idle');
  const history = ref<VoiceTurn[]>([]);

  // Pending confirmation (set when the backend asks for a yes/no).
  const planId = ref<string | undefined>(undefined);
  const confirmation = ref<ConfirmationView | null>(null);
  const requiredPermissions = ref<string[]>([]);

  function pushTurn(role: VoiceTurn['role'], text: string): void {
    history.value.push({ role, text });
    if (history.value.length > 50) history.value.splice(0, history.value.length - 50);
  }

  function apply(res: VoiceTurnResponse): VoiceTurnResponse {
    sessionId.value = res.sessionId;
    switch (res.kind) {
      case 'clarify':
        status.value = 'clarifying';
        confirmation.value = null;
        planId.value = undefined;
        pushTurn('assistant', res.question);
        break;
      case 'confirm':
        status.value = 'confirming';
        planId.value = res.planId;
        confirmation.value = res.summary;
        requiredPermissions.value = res.requiredPermissions;
        pushTurn('assistant', res.summary.title);
        break;
      case 'executed':
        status.value = 'idle';
        planId.value = undefined;
        confirmation.value = null;
        pushTurn('assistant', res.result.message);
        break;
      case 'rejected':
        status.value = 'idle';
        planId.value = undefined;
        confirmation.value = null;
        pushTurn('assistant', res.message);
        break;
    }
    return res;
  }

  async function submit(transcript: string): Promise<VoiceTurnResponse> {
    pushTurn('user', transcript);
    status.value = 'processing';
    const res = await voiceApi.interpret({
      sessionId: sessionId.value,
      transcript,
      locale: 'ar',
    });
    return apply(res);
  }

  async function decide(decision: 'confirm' | 'cancel'): Promise<VoiceTurnResponse | null> {
    if (!sessionId.value || !planId.value) return null;
    status.value = 'processing';
    const res = await voiceApi.decide({
      sessionId: sessionId.value,
      planId: planId.value,
      decision,
    });
    return apply(res);
  }

  function reset(): void {
    status.value = 'idle';
    planId.value = undefined;
    confirmation.value = null;
    requiredPermissions.value = [];
  }

  return {
    sessionId,
    status,
    history,
    planId,
    confirmation,
    requiredPermissions,
    submit,
    decide,
    reset,
  };
});
