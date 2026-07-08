import { defineStore } from 'pinia';
import { ref } from 'vue';
import { aiSessionApi } from '@/services/api/aiSession.api';
import { useToast } from '@/composables/useToast';
import { llmErrorMessage } from '@/services/llmErrorMessages';
import { t } from '@/i18n';
import type {
  AiSessionSummary,
  PlatformCancelResult,
  PlatformClarificationResult,
  PlatformMessageResult,
  PlatformPreviewResult,
} from '@contractor-plus/shared';

// A rendered conversation turn. User turns are plain text; assistant turns carry
// the raw discriminated result so the view can render by `kind`.
export type AiTurn =
  | { role: 'user'; text: string }
  | { role: 'assistant'; result: PlatformMessageResult | PlatformCancelResult };

// Plain-Arabic fallback for a caught exception (mirrors aiCommand.store). The
// interceptor already normalizes API errors to `ApiError` with a `.message`.
function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) {
    return String((e as { message: unknown }).message);
  }
  return 'حدث خطأ غير متوقع، حاول مرة أخرى.';
}

// Generic AI Operating Platform console store. Owns one session at a time, the
// turn stream, and the two "live" states the view acts on: a `pending` preview
// (awaiting confirmation) and an open `clarification` (awaiting an answer).
export const useAiSessionStore = defineStore('aiSession', () => {
  const toast = useToast();

  const sessionId = ref<string | null>(null);
  const turns = ref<AiTurn[]>([]);
  const pending = ref<PlatformPreviewResult | null>(null);
  const clarification = ref<PlatformClarificationResult | null>(null);
  const processing = ref(false);
  const error = ref<string | null>(null);
  const sessions = ref<AiSessionSummary[]>([]);

  /** Open a session lazily; returns the id (existing or newly created). */
  async function ensureSession(): Promise<string | null> {
    if (sessionId.value) return sessionId.value;
    const summary = await aiSessionApi.openSession();
    sessionId.value = summary.id;
    return summary.id;
  }

  /** Fold a message result into the local state (preview/clarification are
   *  mutually exclusive live states; execution/query clear both). */
  function applyMessageResult(result: PlatformMessageResult) {
    if (result.sessionId) sessionId.value = result.sessionId;
    turns.value.push({ role: 'assistant', result });
    pending.value = result.kind === 'preview' ? result : null;
    clarification.value = result.kind === 'clarification' ? result : null;
    if (result.kind === 'execution') toast.success(result.message || t('ai.executed'));
    // A coded LLM failure (rate_limited, invalid_api_key, …) → a specific Arabic
    // message; other rejections keep the server-supplied Arabic message.
    if (result.kind === 'rejected') error.value = llmErrorMessage(result.reason, result.message);
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || processing.value) return;
    error.value = null;
    turns.value.push({ role: 'user', text: trimmed });
    processing.value = true;
    try {
      const id = await ensureSession();
      if (!id) {
        error.value = errMsg(null);
        return;
      }
      applyMessageResult(await aiSessionApi.sendMessage(id, trimmed));
    } catch (e) {
      error.value = errMsg(e);
    } finally {
      processing.value = false;
    }
  }

  async function confirm() {
    if (!sessionId.value || processing.value) return;
    error.value = null;
    processing.value = true;
    try {
      const result = await aiSessionApi.confirm(sessionId.value);
      turns.value.push({ role: 'assistant', result });
      pending.value = null;
      clarification.value = null;
      if (result.kind === 'execution') toast.success(result.message || t('ai.executed'));
      else error.value = llmErrorMessage(result.reason, result.message); // rejected
    } catch (e) {
      error.value = errMsg(e);
    } finally {
      processing.value = false;
    }
  }

  async function cancel() {
    // No live session yet → just drop the local pending/clarification state.
    if (!sessionId.value || processing.value) {
      pending.value = null;
      clarification.value = null;
      return;
    }
    error.value = null;
    processing.value = true;
    try {
      const result = await aiSessionApi.cancel(sessionId.value);
      turns.value.push({ role: 'assistant', result });
      pending.value = null;
      clarification.value = null;
      toast.info(result.message || t('ai.cancelled'));
    } catch (e) {
      error.value = errMsg(e);
    } finally {
      processing.value = false;
    }
  }

  async function loadSessions() {
    try {
      sessions.value = await aiSessionApi.listSessions();
    } catch (e) {
      error.value = errMsg(e);
    }
  }

  function reset() {
    sessionId.value = null;
    turns.value = [];
    pending.value = null;
    clarification.value = null;
    error.value = null;
  }

  return {
    sessionId,
    turns,
    pending,
    clarification,
    processing,
    error,
    sessions,
    ensureSession,
    sendMessage,
    confirm,
    cancel,
    loadSessions,
    reset,
  };
});
