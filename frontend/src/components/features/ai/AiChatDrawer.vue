<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { t, te } from '@/i18n';
import { useUiStore } from '@/stores/ui.store';
import { useAiChat } from '@/composables/useAiChat';
import AiActionConfirmationDialog from '@/components/features/ai/AiActionConfirmationDialog.vue';
import type { PendingAction } from '@/types/aiActions';

// Phase 7 + Phase 8 — the assistant drawer. It answers questions from the four
// reports (through the server-side validation gate), explains the app, AND can
// propose write actions (create customer/project/…). A proposed write is shown
// as a pending card and runs ONLY after the user confirms it explicitly here.
const ui = useUiStore();
const chat = useAiChat();

const input = ref('');
const scroller = ref<HTMLElement | null>(null);
const threadsMenu = ref(false);

const enterToSend = ref(true); // TODO: make this a user preference

// Explicit confirmation gate for a proposed write.
const confirmOpen = ref(false);
const confirmTarget = ref<PendingAction | null>(null);
const executing = computed(() => chat.toolExecutionState.value === 'executing');

function openConfirm(action: PendingAction): void {
  confirmTarget.value = action;
  confirmOpen.value = true;
}

async function onConfirm(secrets: Record<string, string> | undefined): Promise<void> {
  const action = confirmTarget.value;
  if (!action) return;
  const ok = await chat.confirmAction(action.actionId, secrets);
  if (ok) {
    confirmOpen.value = false;
    confirmTarget.value = null;
  }
}

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
        <aside class="cp-chat" role="dialog" aria-modal="true" :aria-label="t('chat.title')">
          <header class="cp-chat__head">
            <div class="cp-chat__heading">
              <span class="cp-chat__heading-icon">
                <v-icon icon="mdi-robot-happy-outline" size="19" />
              </span>

              <span class="cp-chat__title">{{ t('chat.title') }}</span>
            </div>

            <div class="cp-chat__head-actions">
              <v-btn
                variant="text"
                size="small"
                icon="mdi-plus"
                :title="t('chat.newChat')"
                @click="chat.newThread()"
              />

              <v-menu v-model="threadsMenu" :z-index="2500" location="bottom end" :offset="4">
                <template #activator="{ props }">
                  <v-btn
                    v-bind="props"
                    variant="text"
                    size="small"
                    icon="mdi-history"
                    :title="t('chat.history')"
                  />
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
                    @click="
                      threadsMenu = false;
                      chat.openThread(th.id);
                    "
                  >
                    <span class="cp-chat__thread-title">
                      {{ th.title }}
                    </span>

                    <v-icon
                      icon="mdi-delete-outline"
                      size="15"
                      class="cp-chat__thread-del"
                      @click.stop="chat.remove(th.id)"
                    />
                  </button>
                </div>
              </v-menu>

              <span class="cp-chat__head-divider" aria-hidden="true" />

              <v-btn
                variant="text"
                size="small"
                icon="mdi-close"
                :title="t('common.close')"
                @click="ui.closeChat()"
              />
            </div>
          </header>

          <div ref="scroller" class="cp-chat__body">
            <div v-if="chat.messages.value.length === 0 && !disabled" class="cp-chat__empty">
              <span class="cp-chat__empty-icon">
                <v-icon icon="mdi-robot-happy-outline" size="36" />
              </span>

              <p class="cp-chat__empty-title">
                {{ t('chat.welcome') }}
              </p>

              <p class="cp-chat__hint">
                {{ t('chat.welcomeHint') }}
              </p>
            </div>

            <div v-if="disabled" class="cp-chat__disabled">
              <v-icon icon="mdi-cancel" size="19" />
              <span>{{ t('chat.disabled') }}</span>
            </div>

            <div
              v-for="m in chat.messages.value"
              :key="m.id"
              :class="['cp-chat__msg', `is-${m.role}`]"
            >
              <div class="cp-chat__bubble">
                <span v-if="m.toolReportType" class="cp-chat__tool" :title="t('chat.usedReport')">
                  <v-icon icon="mdi-chart-box-outline" size="12" />
                  {{ reportLabel(m.toolReportType) }}
                </span>

                <p class="cp-chat__text">{{ m.content }}</p>
              </div>
            </div>

            <div v-if="chat.sending.value" class="cp-chat__msg is-assistant">
              <div class="cp-chat__bubble cp-chat__bubble--typing">
                <v-progress-circular indeterminate size="14" width="2" />
                <span>{{ t('chat.thinking') }}</span>
              </div>
            </div>

            <!-- Proposed writes awaiting explicit confirmation. -->
            <div v-if="chat.pendingActions.value.length" class="cp-chat__pending">
              <div class="cp-chat__pending-head">
                <v-icon icon="mdi-shield-alert-outline" size="15" />
                <span>{{ t('aiActions.pendingTitle') }}</span>
              </div>

              <div
                v-for="p in chat.pendingActions.value"
                :key="p.actionId"
                class="cp-chat__pending-row"
              >
                <span class="cp-chat__pending-title">
                  {{ p.title }}
                </span>

                <div class="cp-chat__pending-actions">
                  <v-btn
                    variant="text"
                    size="x-small"
                    :disabled="executing"
                    @click="chat.rejectAction(p.actionId)"
                  >
                    {{ t('common.cancel') }}
                  </v-btn>

                  <v-btn
                    color="primary"
                    variant="flat"
                    size="x-small"
                    :disabled="executing"
                    @click="openConfirm(p)"
                  >
                    {{ t('aiActions.review') }}
                  </v-btn>
                </div>
              </div>
            </div>
          </div>

          <p v-if="errorText" class="cp-chat__error">
            <v-icon icon="mdi-alert-circle-outline" size="16" />
            <span>{{ errorText }}</span>
          </p>

          <form class="cp-chat__input" @submit.prevent="submit">
            <div class="cp-chat__composer">
              <textarea
                v-model="input"
                class="cp-chat__field"
                :placeholder="t('chat.placeholder')"
                :disabled="disabled || chat.sending.value"
                @keydown.enter="enterToSend && submit()"
              />

              <v-btn
                type="submit"
                icon="mdi-send"
                color="primary"
                size="small"
                variant="flat"
                class="cp-chat__send"
                :loading="chat.sending.value"
                :disabled="disabled || !input.trim()"
              />
            </div>

            <v-checkbox
              v-model="enterToSend"
              size="small"
              density="compact"
              hide-details
              class="cp-chat__enter-option"
              :disabled="disabled || chat.sending.value"
            >
              <template #label>
                <span class="cp-chat__enter-label">
                  <v-hotkey keys="Enter" variant="flat" platform="auto" />
                  <span>اضغط Enter للإرسال</span>
                </span>
              </template>
            </v-checkbox>

            <!-- @keydown.enter.exact.prevent="submit" -->
          </form>

          <AiActionConfirmationDialog
            v-model="confirmOpen"
            :action="confirmTarget"
            :executing="executing"
            @confirm="onConfirm"
            @cancel="confirmOpen = false"
          />
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
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(15, 23, 42, 0.42);
  backdrop-filter: blur(3px);
}

.cp-chat {
  display: flex;
  flex-direction: column;
  width: min(1040px, 100%);
  height: min(820px, calc(100dvh - 32px));
  min-height: 420px;
  overflow: hidden;
  color: var(--cp-text);
  background: var(--cp-surface);
  border: 1px solid var(--cp-border);
  border-radius: calc(var(--cp-radius-md) + 4px);
  box-shadow: var(--cp-shadow-lg);
}

/* Header */
.cp-chat__head {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  min-height: 54px;
  padding: 7px 10px 7px 14px;
  border-block-end: 1px solid var(--cp-border);
  background: var(--cp-surface);
}

.cp-chat__heading,
.cp-chat__head-actions {
  display: flex;
  align-items: center;
}

.cp-chat__heading {
  min-width: 0;
  gap: 9px;
}

.cp-chat__heading-icon {
  display: grid;
  flex: none;
  width: 32px;
  height: 32px;
  place-items: center;
  color: var(--cp-primary);
  background: var(--cp-primary-soft);
  border-radius: 50%;
}

.cp-chat__title {
  overflow: hidden;
  font-size: 0.9rem;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cp-chat__head-actions {
  flex: none;
  gap: 2px;
}

.cp-chat__head-divider {
  width: 1px;
  height: 22px;
  margin-inline: 4px;
  background: var(--cp-border);
}

/* Messages area */
.cp-chat__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  padding: 18px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  background: linear-gradient(
    color-mix(in srgb, var(--cp-surface-2) 38%, transparent),
    color-mix(in srgb, var(--cp-surface-2) 38%, transparent)
  );
}

.cp-chat__empty,
.cp-chat__disabled {
  margin: auto;
  color: var(--cp-text-muted);
  text-align: center;
}

.cp-chat__empty {
  max-width: 360px;
  font-size: 0.84rem;
}

.cp-chat__empty-icon {
  display: grid;
  width: 64px;
  height: 64px;
  margin: 0 auto 12px;
  place-items: center;
  color: var(--cp-primary);
  background: var(--cp-primary-soft);
  border: 1px solid color-mix(in srgb, var(--cp-primary) 16%, transparent);
  border-radius: 50%;
}

.cp-chat__empty-title {
  margin: 0;
  color: var(--cp-text);
  font-size: 0.92rem;
  font-weight: 700;
}

.cp-chat__hint {
  margin: 5px 0 0;
  font-size: 0.77rem;
  line-height: 1.7;
}

.cp-chat__disabled {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  font-size: 0.82rem;
  background: var(--cp-surface);
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius-md);
}

.cp-chat__msg {
  display: flex;
  width: 100%;
}

.cp-chat__msg.is-user {
  justify-content: flex-start;
}

.cp-chat__msg.is-assistant {
  justify-content: flex-end;
}

.cp-chat__bubble {
  max-width: min(78%, 720px);
  padding: 9px 12px;
  font-size: 0.84rem;
  line-height: 1.7;
  overflow-wrap: anywhere;
  border-radius: var(--cp-radius-md);
}

.cp-chat__msg.is-user .cp-chat__bubble {
  color: #fff;
  background: var(--cp-primary);
  border-start-start-radius: 4px;
  box-shadow: 0 3px 10px color-mix(in srgb, var(--cp-primary) 18%, transparent);
}

.cp-chat__msg.is-assistant .cp-chat__bubble {
  background: var(--cp-surface);
  border: 1px solid var(--cp-border);
  border-start-end-radius: 4px;
  box-shadow: 0 2px 7px rgba(15, 23, 42, 0.04);
}

.cp-chat__bubble--typing {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--cp-text-muted);
}

.cp-chat__tool {
  display: flex;
  width: fit-content;
  align-items: center;
  gap: 4px;
  margin-block-end: 5px;
  padding: 2px 7px;
  color: var(--cp-text-muted);
  font-size: 0.67rem;
  background: var(--cp-surface-2);
  border: 1px solid var(--cp-border);
  border-radius: 999px;
}

.cp-chat__text {
  margin: 0;
  white-space: pre-wrap;
}

/* Pending actions */
.cp-chat__pending {
  display: flex;
  flex-direction: column;
  gap: 7px;
  width: min(100%, 720px);
  margin-block-start: 4px;
  padding: 10px;
  background: var(--cp-surface);
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius-md);
}

.cp-chat__pending-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-block-end: 1px;
  color: var(--cp-text-muted);
  font-size: 0.76rem;
  font-weight: 700;
}

.cp-chat__pending-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 42px;
  padding: 6px 8px;
  background: var(--cp-surface-2);
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius-sm);
}

.cp-chat__pending-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 0.8rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cp-chat__pending-actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 4px;
}

/* Error */
.cp-chat__error {
  display: flex;
  flex: none;
  align-items: center;
  gap: 7px;
  margin: 0;
  padding: 8px 14px;
  color: rgb(var(--v-theme-error));
  font-size: 0.77rem;
  background: color-mix(in srgb, rgb(var(--v-theme-error)) 8%, var(--cp-surface));
  border-block-start: 1px solid color-mix(in srgb, rgb(var(--v-theme-error)) 22%, transparent);
}

/* Composer */
.cp-chat__input {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 5px;
  padding: 10px 12px 8px;
  background: var(--cp-surface);
  border-block-start: 1px solid var(--cp-border);
}

.cp-chat__composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.cp-chat__field {
  flex: 1;
  min-height: 40px;
  max-height: 120px;
  padding: 9px 11px;
  overflow-y: auto;
  resize: none;
  color: var(--cp-text);
  font: inherit;
  font-size: 0.84rem;
  line-height: 1.55;
  background: var(--cp-surface-2);
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius-md);
  outline: none;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    background-color 0.15s ease;
}

.cp-chat__field::placeholder {
  color: var(--cp-text-muted);
}

.cp-chat__field:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--cp-primary) 42%, var(--cp-border));
}

.cp-chat__field:focus {
  background: var(--cp-surface);
  border-color: var(--cp-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--cp-primary) 12%, transparent);
}

.cp-chat__field:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.cp-chat__send {
  flex: none;
  margin-block-end: 2px;
}

.cp-chat__enter-option {
  align-self: flex-start;
  margin: 0;
}

.cp-chat__enter-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--cp-text-muted);
  font-size: 0.72rem;
}

/* Threads menu */
.cp-chat__threads {
  min-width: 270px;
  max-width: min(360px, calc(100vw - 24px));
  max-height: 360px;
  padding: 5px;
  overflow-y: auto;
  background: var(--cp-surface);
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius-md);
  box-shadow: var(--cp-shadow-lg);
}

.cp-chat__threads-empty {
  padding: 14px 12px;
  color: var(--cp-text-muted);
  font-size: 0.78rem;
  text-align: center;
}

.cp-chat__thread {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 38px;
  padding: 7px 10px;
  color: var(--cp-text);
  font: inherit;
  font-size: 0.79rem;
  text-align: start;
  background: transparent;
  border: 0;
  border-radius: var(--cp-radius-sm);
  cursor: pointer;
  transition:
    color 0.15s ease,
    background-color 0.15s ease;
}

.cp-chat__thread:hover {
  background: var(--cp-primary-soft);
}

.cp-chat__thread.is-active {
  color: var(--cp-primary);
  font-weight: 600;
  background: var(--cp-primary-soft);
}

.cp-chat__thread-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cp-chat__thread-del {
  flex: none;
  opacity: 0.45;
  transition:
    color 0.15s ease,
    opacity 0.15s ease;
}

.cp-chat__thread:hover .cp-chat__thread-del,
.cp-chat__thread-del:hover {
  opacity: 1;
}

.cp-chat__thread-del:hover {
  color: rgb(var(--v-theme-error));
}

/* Transition */
.cp-chat-fade-enter-active,
.cp-chat-fade-leave-active {
  transition: opacity 0.16s ease;
}

.cp-chat-fade-enter-active .cp-chat,
.cp-chat-fade-leave-active .cp-chat {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}

.cp-chat-fade-enter-from,
.cp-chat-fade-leave-to {
  opacity: 0;
}

.cp-chat-fade-enter-from .cp-chat,
.cp-chat-fade-leave-to .cp-chat {
  opacity: 0;
  transform: translateY(8px) scale(0.99);
}

/* Responsive */
@media (max-width: 720px) {
  .cp-chat-scrim {
    padding: 0;
  }

  .cp-chat {
    width: 100%;
    height: 100dvh;
    min-height: 0;
    border: 0;
    border-radius: 0;
  }

  .cp-chat__head {
    min-height: 52px;
    padding-inline: 10px 6px;
  }

  .cp-chat__body {
    padding: 12px;
  }

  .cp-chat__bubble {
    max-width: 88%;
  }

  .cp-chat__input {
    padding: 9px 10px 7px;
  }

  .cp-chat__pending-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .cp-chat__pending-actions {
    align-self: flex-end;
  }
}

@media (max-width: 420px) {
  .cp-chat__heading-icon {
    width: 30px;
    height: 30px;
  }

  .cp-chat__title {
    max-width: 130px;
  }

  .cp-chat__head-divider {
    display: none;
  }

  .cp-chat__bubble {
    max-width: 94%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .cp-chat-fade-enter-active,
  .cp-chat-fade-leave-active,
  .cp-chat-fade-enter-active .cp-chat,
  .cp-chat-fade-leave-active .cp-chat {
    transition: none;
  }
}
</style>
