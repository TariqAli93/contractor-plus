import { defineStore } from 'pinia';
import { ref } from 'vue';
import { aiCommandApi } from '@/services/api/aiCommand.api';
import type {
  AiCancelResult,
  AiConfirmResult,
  AiConfirmationPlan,
  AiInsights,
  AiInterpretResult,
} from '@contractor-plus/shared';

type AiResult = AiInterpretResult | AiConfirmResult | AiCancelResult;

export type AiTurn =
  | { role: 'user'; text: string }
  | { role: 'assistant'; result: AiResult };

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return 'حدث خطأ غير متوقع، حاول مرة أخرى.';
}

export const useAiCommandStore = defineStore('aiCommand', () => {
  const open = ref(false);
  const processing = ref(false);
  const sessionId = ref<string | null>(null);
  const turns = ref<AiTurn[]>([]);
  const pending = ref<AiConfirmationPlan | null>(null);
  const error = ref<string | null>(null);
  const insights = ref<AiInsights | null>(null);

  async function loadInsights() {
    try {
      insights.value = await aiCommandApi.getInsights();
    } catch {
      /* non-fatal — the console still works without a briefing */
    }
  }

  function toggle() {
    open.value = !open.value;
    if (open.value && !insights.value) void loadInsights();
  }
  function reset() {
    turns.value = [];
    pending.value = null;
    sessionId.value = null;
    error.value = null;
  }

  function apply(result: AiResult) {
    if ('sessionId' in result && result.sessionId) sessionId.value = result.sessionId;
    pending.value = result.kind === 'workflow_plan' ? result : null;
    turns.value.push({ role: 'assistant', result });
  }

  async function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || processing.value) return;
    error.value = null;
    turns.value.push({ role: 'user', text: trimmed });
    processing.value = true;
    try {
      apply(await aiCommandApi.interpret(trimmed, sessionId.value ?? undefined));
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
      apply(await aiCommandApi.confirm(sessionId.value));
    } catch (e) {
      error.value = errMsg(e);
    } finally {
      processing.value = false;
    }
  }

  async function cancel() {
    if (!sessionId.value || processing.value) {
      pending.value = null;
      return;
    }
    error.value = null;
    processing.value = true;
    try {
      apply(await aiCommandApi.cancel(sessionId.value));
    } catch (e) {
      error.value = errMsg(e);
    } finally {
      processing.value = false;
    }
  }

  return { open, processing, sessionId, turns, pending, error, insights, toggle, reset, submit, confirm, cancel, loadInsights };
});
