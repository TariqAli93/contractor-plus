import { ref } from 'vue';
import { aiApi } from '@/services/api/ai.api';
import { ApiError } from '@/types/api';
import type { ChatMessage, ChatThreadSummary } from '@/types/ai';

/**
 * Chat state for the assistant drawer (Phase 7). Owner-scoped on the server;
 * the client only holds the current thread's messages + the thread list.
 */
export function useAiChat() {
  const threads = ref<ChatThreadSummary[]>([]);
  const activeThreadId = ref<string | null>(null);
  const messages = ref<ChatMessage[]>([]);
  const sending = ref(false);
  const loading = ref(false);
  const error = ref<string | null>(null);

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
    } catch (e) {
      error.value = errMsg(e);
    } finally {
      loading.value = false;
    }
  }

  function newThread(): void {
    activeThreadId.value = null;
    messages.value = [];
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
      if (isNew) await loadThreads();
    } catch (e) {
      error.value = errMsg(e);
    } finally {
      sending.value = false;
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
    threads, activeThreadId, messages, sending, loading, error,
    loadThreads, openThread, newThread, send, remove,
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
