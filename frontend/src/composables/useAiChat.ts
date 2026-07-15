import { ref } from 'vue';
import { aiApi } from '@/services/api/ai.api';
import { ApiError } from '@/types/api';
import type { ChatMessage, ChatThreadSummary } from '@/types/ai';
import type { PendingAction } from '@/types/aiActions';

/**
 * Chat state for the assistant drawer (Phase 7 + Phase 8). Owner-scoped on the
 * server; the client holds the current thread's messages, the thread list, and
 * any pending write actions the assistant proposed this session. A write NEVER
 * runs on send — only through an explicit confirmAction(actionId).
 */
export function useAiChat() {
  const threads = ref<ChatThreadSummary[]>([]);
  const activeThreadId = ref<string | null>(null);
  const messages = ref<ChatMessage[]>([]);
  const pendingActions = ref<PendingAction[]>([]);
  const sending = ref(false);
  const loading = ref(false);
  const error = ref<string | null>(null);
  /** 'idle' | 'executing' — the confirm dialog disables its button while executing. */
  const toolExecutionState = ref<'idle' | 'executing'>('idle');

  async function loadThreads(): Promise<void> {
    try {
      threads.value = (await aiApi.chatThreads()).items;
    } catch {
      // Non-fatal: an empty list still lets the user start a new chat.
      threads.value = [];
    }
  }

  async function openThread(threadId: string): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const thread = await aiApi.chatThread(threadId);
      activeThreadId.value = thread.id;
      messages.value = thread.messages;
      // Pending actions are session-scoped (not persisted per thread).
      pendingActions.value = [];
    } catch (e) {
      error.value = errMsg(e);
    } finally {
      loading.value = false;
    }
  }

  function newThread(): void {
    activeThreadId.value = null;
    messages.value = [];
    pendingActions.value = [];
    error.value = null;
  }

  async function send(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || sending.value) return;
    // Optimistic user bubble.
    messages.value.push({
      id: `local-${Date.now()}`,
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString(),
    });
    sending.value = true;
    error.value = null;
    try {
      const res = await aiApi.chatSend(trimmed, activeThreadId.value);
      const isNew = activeThreadId.value === null;
      activeThreadId.value = res.threadId;
      messages.value.push(res.message);
      // Surface any proposed writes for explicit confirmation.
      for (const p of res.pendingActions ?? []) pendingActions.value.push(p);
      if (isNew) await loadThreads();
    } catch (e) {
      error.value = errMsg(e);
    } finally {
      sending.value = false;
    }
  }

  /**
   * Confirm a proposed write by its actionId. The backend re-validates, executes
   * ONCE (idempotent claim), and returns a result summary. Guarded against a
   * double click while a confirmation is in flight.
   */
  async function confirmAction(
    actionId: string,
    secrets?: Record<string, string>,
  ): Promise<boolean> {
    if (toolExecutionState.value === 'executing') return false;
    toolExecutionState.value = 'executing';
    error.value = null;
    try {
      const result = await aiApi.confirmAction(actionId, secrets);
      pendingActions.value = pendingActions.value.filter((p) => p.actionId !== actionId);
      // Echo the outcome as an assistant turn so the thread reads coherently.
      messages.value.push({
        id: `local-${Date.now()}`,
        role: 'assistant',
        content: result.summary,
        createdAt: new Date().toISOString(),
      });
      return true;
    } catch (e) {
      error.value = errMsg(e);
      return false;
    } finally {
      toolExecutionState.value = 'idle';
    }
  }

  async function rejectAction(actionId: string): Promise<void> {
    try {
      await aiApi.rejectAction(actionId);
    } catch (e) {
      error.value = errMsg(e);
    } finally {
      pendingActions.value = pendingActions.value.filter((p) => p.actionId !== actionId);
    }
  }

  async function remove(threadId: string): Promise<void> {
    try {
      await aiApi.chatDeleteThread(threadId);
      threads.value = threads.value.filter((t) => t.id !== threadId);
      if (activeThreadId.value === threadId) newThread();
    } catch (e) {
      error.value = errMsg(e);
    }
  }

  return {
    threads, activeThreadId, messages, pendingActions, sending, loading, error,
    toolExecutionState,
    loadThreads, openThread, newThread, send, remove,
    confirmAction, rejectAction,
  };
}

function errMsg(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'AI_FEATURE_DISABLED' || e.code === 'AI_DISABLED') return 'chat_disabled';
    if (e.code === 'AI_BUDGET_EXCEEDED') return 'budget';
    return e.message;
  }
  return 'generic';
}
