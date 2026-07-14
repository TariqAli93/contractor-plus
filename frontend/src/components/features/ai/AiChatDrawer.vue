<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { t, te } from '@/i18n';
import { useUiStore } from '@/stores/ui.store';
import { useAiChat } from '@/composables/useAiChat';

// Phase 7 — the assistant drawer. A read-only conversational helper: it can
// answer questions from the four reports (through the server-side validation
// gate) and explain how to use the app. It never mutates data.
const ui = useUiStore();
const chat = useAiChat();

const input = ref('');
const scroller = ref<HTMLElement | null>(null);
const threadsMenu = ref(false);

// Load the thread list the first time the drawer opens.
watch(
  () => ui.chatOpen,
  async (open) => {
    if (open && chat.threads.value.length === 0 && chat.activeThreadId.value === null) {
      await chat.loadThreads();
    }
  },
);

watch(
  () => chat.messages.value.length,
  async () => {
    await nextTick();
    if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight;
  },
);

const disabled = computed(() => chat.error.value === 'chat_disabled');

const errorText = computed(() => {
  const e = chat.error.value;
  if (!e || e === 'chat_disabled') return '';
  if (e === 'budget') return t('chat.errors.budget');
  if (e === 'generic') return t('chat.errors.generic');
  return e;
});

async function submit() {
  const text = input.value;
  input.value = '';
  await chat.send(text);
}

function reportLabel(type: string): string {
  const key = `chat.reportTools.${type}`;
  return te(key) ? t(key) : type;
}
</script>

<template>
  <Teleport to="body">
    <Transition name="cp-chat-fade">
      <div v-if="ui.chatOpen" class="cp-chat-scrim" @click.self="ui.closeChat()">
        <aside class="cp-chat" role="dialog" :aria-label="t('chat.title')">
          <header class="cp-chat__head">
            <v-icon icon="mdi-robot-happy-outline" size="18" />
            <span class="cp-chat__title">{{ t('chat.title') }}</span>
            <v-spacer />
            <v-btn
              variant="text"
              size="small"
              icon="mdi-plus"
              :title="t('chat.newChat')"
              @click="chat.newThread()"
            />
            <v-menu v-model="threadsMenu" location="bottom end" offset="2">
              <template #activator="{ props }">
                <v-btn v-bind="props" variant="text" size="small" icon="mdi-history" :title="t('chat.history')" />
              </template>
              <div class="cp-chat__threads">
                <div v-if="chat.threads.value.length === 0" class="cp-chat__threads-empty">
                  {{ t('chat.noThreads') }}
                </div>
                <button
                  v-for="th in chat.threads.value"
                  :key="th.id"
                  type="button"
                  class="cp-chat__thread"
                  :class="{ 'is-active': th.id === chat.activeThreadId.value }"
                  @click="threadsMenu = false; chat.openThread(th.id)"
                >
                  <span class="cp-chat__thread-title">{{ th.title }}</span>
                  <v-icon
                    icon="mdi-delete-outline"
                    size="14"
                    class="cp-chat__thread-del"
                    @click.stop="chat.remove(th.id)"
                  />
                </button>
              </div>
            </v-menu>
            <v-btn variant="text" size="small" icon="mdi-close" :title="t('common.close')" @click="ui.closeChat()" />
          </header>

          <div ref="scroller" class="cp-chat__body">
            <div v-if="chat.messages.value.length === 0 && !disabled" class="cp-chat__empty">
              <v-icon icon="mdi-robot-happy-outline" size="34" class="cp-chat__empty-icon" />
              <p>{{ t('chat.welcome') }}</p>
              <p class="cp-chat__hint">{{ t('chat.welcomeHint') }}</p>
            </div>

            <div v-if="disabled" class="cp-chat__disabled">
              <v-icon icon="mdi-cancel" size="18" />
              {{ t('chat.disabled') }}
            </div>

            <div
              v-for="m in chat.messages.value"
              :key="m.id"
              :class="['cp-chat__msg', `is-${m.role}`]"
            >
              <div class="cp-chat__bubble">
                <span
                  v-if="m.toolReportType"
                  class="cp-chat__tool"
                  :title="t('chat.usedReport')"
                >
                  <v-icon icon="mdi-chart-box-outline" size="12" />
                  {{ reportLabel(m.toolReportType) }}
                </span>
                <p class="cp-chat__text">{{ m.content }}</p>
              </div>
            </div>

            <div v-if="chat.sending.value" class="cp-chat__msg is-assistant">
              <div class="cp-chat__bubble cp-chat__bubble--typing">
                <v-progress-circular indeterminate size="14" width="2" />
                {{ t('chat.thinking') }}
              </div>
            </div>
          </div>

          <p v-if="errorText" class="cp-chat__error">{{ errorText }}</p>

          <form class="cp-chat__input" @submit.prevent="submit">
            <textarea
              v-model="input"
              class="cp-chat__field"
              :placeholder="t('chat.placeholder')"
              rows="1"
              :disabled="disabled || chat.sending.value"
              @keydown.enter.exact.prevent="submit"
            />
            <v-btn
              type="submit"
              icon="mdi-send"
              color="primary"
              size="small"
              variant="flat"
              :loading="chat.sending.value"
              :disabled="disabled || !input.trim()"
            />
          </form>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.cp-chat-scrim {
  position: fixed;
  inset: 0;
  z-index: 2400;
  background: rgba(0, 0, 0, 0.28);
  display: flex;
  justify-content: flex-start; /* RTL → drawer on the inline-start visual edge */
}
.cp-chat {
  width: 380px;
  max-width: 92vw;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--cp-surface);
  border-inline-end: 1px solid var(--cp-border);
  box-shadow: var(--cp-shadow-lg);
}
.cp-chat__head {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding-inline: 10px 4px;
  border-block-end: 1px solid var(--cp-border);
  flex: none;
}
.cp-chat__title {
  font-size: 0.86rem;
  font-weight: 600;
}
.cp-chat__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cp-chat__empty {
  margin: auto;
  text-align: center;
  color: var(--cp-text-muted);
  font-size: 0.82rem;
}
.cp-chat__empty-icon {
  color: var(--cp-primary);
  opacity: 0.7;
  margin-bottom: 6px;
}
.cp-chat__hint {
  font-size: 0.74rem;
  margin-top: 2px;
}
.cp-chat__disabled {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: auto;
  color: var(--cp-text-muted);
  font-size: 0.82rem;
}
.cp-chat__msg {
  display: flex;
}
.cp-chat__msg.is-user {
  justify-content: flex-start;
}
.cp-chat__msg.is-assistant {
  justify-content: flex-end;
}
.cp-chat__bubble {
  max-width: 84%;
  padding: 7px 10px;
  border-radius: var(--cp-radius-md);
  font-size: 0.82rem;
  line-height: 1.6;
}
.cp-chat__msg.is-user .cp-chat__bubble {
  background: var(--cp-primary);
  color: #fff;
  border-start-start-radius: 3px;
}
.cp-chat__msg.is-assistant .cp-chat__bubble {
  background: var(--cp-surface-2);
  border: 1px solid var(--cp-border);
  border-start-end-radius: 3px;
}
.cp-chat__bubble--typing {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--cp-text-muted);
}
.cp-chat__tool {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-bottom: 4px;
  padding: 1px 6px;
  font-size: 0.66rem;
  color: var(--cp-text-muted);
  background: var(--cp-surface);
  border: 1px solid var(--cp-border);
  border-radius: 999px;
}
.cp-chat__text {
  margin: 0;
  white-space: pre-line;
}
.cp-chat__error {
  margin: 0;
  padding: 6px 10px;
  font-size: 0.76rem;
  color: rgb(var(--v-theme-error));
}
.cp-chat__input {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  padding: 8px;
  border-block-start: 1px solid var(--cp-border);
  flex: none;
}
.cp-chat__field {
  flex: 1;
  resize: none;
  max-height: 120px;
  padding: 7px 9px;
  font: inherit;
  font-size: 0.82rem;
  color: var(--cp-text);
  background: var(--cp-surface-2);
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius-sm);
  outline: none;
}
.cp-chat__field:focus {
  border-color: var(--cp-primary);
}
.cp-chat__threads {
  min-width: 240px;
  max-height: 320px;
  overflow-y: auto;
  padding: 3px 0;
  background: var(--cp-surface);
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius-sm);
  box-shadow: var(--cp-shadow-lg);
}
.cp-chat__threads-empty {
  padding: 8px 10px;
  font-size: 0.76rem;
  color: var(--cp-text-muted);
}
.cp-chat__thread {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 5px 10px;
  font-size: 0.78rem;
  background: transparent;
  border: 0;
  text-align: start;
  cursor: default;
}
.cp-chat__thread:hover {
  background: var(--cp-primary-soft);
}
.cp-chat__thread.is-active {
  background: var(--cp-primary-soft);
  color: var(--cp-primary);
}
.cp-chat__thread-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cp-chat__thread-del {
  opacity: 0.5;
}
.cp-chat__thread-del:hover {
  opacity: 1;
  color: rgb(var(--v-theme-error));
}
.cp-chat-fade-enter-active,
.cp-chat-fade-leave-active {
  transition: opacity 0.15s ease;
}
.cp-chat-fade-enter-from,
.cp-chat-fade-leave-to {
  opacity: 0;
}
</style>
