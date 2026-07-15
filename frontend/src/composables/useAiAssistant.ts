import { computed, ref } from 'vue';
import { aiApi } from '@/services/api/ai.api';
import { friendlyError } from '@/lib/errorMessages';
import { useApiError } from './useApiError';
import { useToast } from './useToast';
import type { PendingAction, ToolResult } from '@/types/aiActions';

export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
  toolResults?: ToolResult[];
}

// The assistant surface: send a message, collect proposed writes (pending
// actions), and confirm/reject them. Writes NEVER happen on send — only through
// an explicit confirmAction(actionId), which the backend re-validates and
// executes once. Double-confirm is blocked here (button guard) and in the
// backend (idempotent claim).
export function useAiAssistant() {
  const messages = ref<AssistantMessage[]>([]);
  const pendingActions = ref<PendingAction[]>([]);
  const sending = ref(false);
  /** 'idle' | 'executing' — the confirm dialog disables its button while executing. */
  const toolExecutionState = ref<'idle' | 'executing'>('idle');
  const executingActionId = ref<string | null>(null);
  const toolError = ref<string | null>(null);

  const { handle } = useApiError();
  const toast = useToast();

  const isBusy = computed(() => sending.value || toolExecutionState.value === 'executing');

  async function sendMessage(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || sending.value) return;
    messages.value.push({ role: 'user', content: trimmed });
    sending.value = true;
    toolError.value = null;
    try {
      const res = await aiApi.toolMessage(trimmed);
      messages.value.push({ role: 'assistant', content: res.message, toolResults: res.toolResults });
      for (const p of res.pendingActions) pendingActions.value.push(p);
    } catch (e) {
      handle(e);
      messages.value.push({ role: 'assistant', content: friendlyError(e) });
    } finally {
      sending.value = false;
    }
  }

  async function confirmAction(
    actionId: string,
    secrets?: Record<string, string>,
  ): Promise<ToolResult | null> {
    // Guard against a double click while a confirmation is in flight.
    if (toolExecutionState.value === 'executing') return null;
    toolExecutionState.value = 'executing';
    executingActionId.value = actionId;
    toolError.value = null;
    try {
      const result = await aiApi.confirmAction(actionId, secrets);
      pendingActions.value = pendingActions.value.filter((p) => p.actionId !== actionId);
      messages.value.push({ role: 'assistant', content: result.summary, toolResults: [result] });
      toast.success(result.summary);
      return result;
    } catch (e) {
      toolError.value = friendlyError(e);
      handle(e);
      return null;
    } finally {
      toolExecutionState.value = 'idle';
      executingActionId.value = null;
    }
  }

  async function rejectAction(actionId: string): Promise<void> {
    try {
      await aiApi.rejectAction(actionId);
    } catch (e) {
      handle(e);
    } finally {
      pendingActions.value = pendingActions.value.filter((p) => p.actionId !== actionId);
    }
  }

  async function loadPending(): Promise<void> {
    try {
      const { items } = await aiApi.pendingActions();
      pendingActions.value = items;
    } catch (e) {
      handle(e);
    }
  }

  return {
    messages,
    pendingActions,
    sending,
    isBusy,
    toolExecutionState,
    executingActionId,
    toolError,
    sendMessage,
    confirmAction,
    rejectAction,
    loadPending,
  };
}
