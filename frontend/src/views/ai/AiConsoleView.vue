<script setup lang="ts">
// AI Operating Platform console — a full-page, generic, tool-agnostic chat
// surface over the /ai session pipeline. It renders the turn stream (user +
// assistant bubbles by kind), a pending tool preview via the renderer registry
// (with a confirm gate), and an inline clarification follow-up. All rendering is
// driven by the discriminated `Platform*Result` shapes; no money/qty math here.
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { t } from '@/i18n';
import PageHeader from '@/components/shared/PageHeader.vue';
import { useAiSessionStore, type AiTurn } from '@/stores/aiSession.store';
import { useConfirm } from '@/composables/useConfirm';
import { resolveRenderer } from '@/components/ai/preview/toolRenderers';

const store = useAiSessionStore();
const { turns, pending, clarification, processing, error } = storeToRefs(store);
const { confirm: askConfirm } = useConfirm();

const input = ref('');
const clarifyInput = ref('');
const scrollEl = ref<HTMLElement | null>(null);

type AssistantResult = Extract<AiTurn, { role: 'assistant' }>['result'];

// Every result kind carries a human string in a different field — normalize it.
function bubbleMessage(r: AssistantResult): string {
  if (r.kind === 'clarification') return r.question;
  if (r.kind === 'preview') return r.summary;
  return r.message;
}

function bubbleClass(r: AssistantResult): string {
  if (r.kind === 'rejected') return 'ai-assistant ai-assistant--error';
  if (r.kind === 'execution') return 'ai-assistant ai-assistant--ok';
  if (r.kind === 'preview') return 'ai-assistant ai-assistant--plan';
  return 'ai-assistant';
}

function actionLabel(operation: string): string {
  return t(`ai.action.${operation}`);
}

const pendingRenderer = computed(() =>
  pending.value ? resolveRenderer(pending.value.renderKind) : null,
);

function send() {
  const text = input.value;
  input.value = '';
  void store.sendMessage(text);
}

function sendClarification() {
  const text = clarifyInput.value;
  clarifyInput.value = '';
  void store.sendMessage(text);
}

function onOption(label: string) {
  void store.sendMessage(label);
}

// Confirm the pending preview behind a confirmation dialog (the human gate
// before any mutation runs server-side).
async function onConfirm() {
  const p = pending.value;
  if (!p) return;
  const ok = await askConfirm({
    title: t('ai.confirmTitle'),
    message: p.summary || t('ai.confirmMessage'),
    confirmText: t('ai.confirm'),
  });
  if (!ok) return;
  await store.confirm();
}

function onCancel() {
  void store.cancel();
}

// Keep the newest turn in view.
watch(
  () => turns.value.length,
  async () => {
    await nextTick();
    if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight;
  },
);

onMounted(() => {
  void store.loadSessions();
});
</script>

<template>
  <div class="mx-auto ai-console" style="max-width: 900px">
    <PageHeader
      :title="t('ai.title')"
      icon="mdi-robot-happy-outline"
      :hint="t('ai.hint')"
    />

    <v-card class="ai-console__card">
      <div ref="scrollEl" class="ai-console__stream">
        <div v-if="!turns.length" class="ai-console__empty">
          {{ t('ai.emptyState') }}
        </div>

        <div v-for="(turn, i) in turns" :key="i" class="ai-row" :class="turn.role">
          <div v-if="turn.role === 'user'" class="ai-bubble ai-user">{{ turn.text }}</div>
          <div v-else class="ai-bubble" :class="bubbleClass(turn.result)">
            <div class="ai-msg">{{ bubbleMessage(turn.result) }}</div>

            <ul
              v-if="turn.result.kind === 'execution' && turn.result.executedActions.length"
              class="ai-actions"
            >
              <li v-for="(a, j) in turn.result.executedActions" :key="j">
                {{ actionLabel(a.operation) }} · {{ a.entity }}
              </li>
            </ul>

            <div
              v-if="turn.result.kind === 'clarification' && turn.result.missing.length"
              class="ai-missing"
            >
              {{ turn.result.missing.join('، ') }}
            </div>
          </div>
        </div>

        <div v-if="error" class="ai-error">{{ error }}</div>
      </div>

      <!-- Pending tool preview (confirmation flow) -->
      <div v-if="pending && pendingRenderer" class="ai-console__preview">
        <component
          :is="pendingRenderer"
          :preview="pending"
          :busy="processing"
          @confirm="onConfirm"
          @cancel="onCancel"
        />
      </div>

      <!-- Clarification follow-up -->
      <div v-else-if="clarification" class="ai-console__clarify">
        <p class="ai-clarify-q">{{ clarification.question }}</p>
        <div v-if="clarification.options?.length" class="ai-options">
          <v-chip
            v-for="o in clarification.options"
            :key="o.id"
            size="small"
            variant="tonal"
            @click="onOption(o.label)"
          >
            {{ o.label }}
          </v-chip>
        </div>
        <div class="ai-inline-input">
          <v-text-field
            v-model="clarifyInput"
            density="compact"
            hide-details
            variant="solo-filled"
            flat
            :placeholder="t('ai.clarify.answer')"
            :disabled="processing"
            @keyup.enter="sendClarification"
          />
          <v-btn
            icon="mdi-send"
            color="primary"
            :loading="processing"
            :disabled="!clarifyInput.trim()"
            @click="sendClarification"
          />
        </div>
      </div>

      <v-divider />

      <div class="ai-console__input">
        <v-text-field
          v-model="input"
          density="compact"
          hide-details
          variant="solo-filled"
          flat
          :placeholder="t('ai.inputPlaceholder')"
          :disabled="processing"
          @keyup.enter="send"
        />
        <v-btn
          icon="mdi-send"
          color="primary"
          :loading="processing"
          :disabled="!input.trim()"
          @click="send"
        />
      </div>

      <v-progress-linear v-if="processing" indeterminate color="primary" />
    </v-card>

    <p v-if="processing" class="ai-console__thinking">{{ t('ai.thinking') }}</p>
  </div>
</template>

<style scoped>
.ai-console__card {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 160px);
  min-height: 420px;
  overflow: hidden;
}
.ai-console__stream {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ai-console__empty {
  color: var(--cp-text-muted, #888);
  font-size: 0.88rem;
  text-align: center;
  margin: auto;
  line-height: 1.9;
  max-width: 52ch;
}
.ai-row {
  display: flex;
}
.ai-row.user {
  justify-content: flex-start;
}
.ai-row.assistant {
  justify-content: flex-end;
}
.ai-bubble {
  max-width: 80%;
  padding: 9px 13px;
  border-radius: 12px;
  font-size: 0.9rem;
  line-height: 1.6;
  white-space: pre-wrap;
}
.ai-user {
  background: rgb(var(--v-theme-primary));
  color: #fff;
}
.ai-assistant {
  background: var(--cp-surface-2, rgba(128, 128, 128, 0.12));
}
.ai-assistant--error {
  background: rgba(var(--v-theme-error), 0.12);
}
.ai-assistant--ok {
  background: rgba(var(--v-theme-success), 0.14);
}
.ai-assistant--plan {
  background: rgba(var(--v-theme-warning), 0.14);
}
.ai-actions {
  margin: 6px 0 0;
  padding-inline-start: 18px;
  font-size: 0.8rem;
  opacity: 0.85;
}
.ai-missing {
  margin-top: 6px;
  font-size: 0.78rem;
  color: var(--cp-text-muted, #888);
}
.ai-error {
  color: rgb(var(--v-theme-error));
  font-size: 0.84rem;
  text-align: center;
}
.ai-console__preview {
  padding: 12px 14px;
  border-top: 1px solid var(--cp-border);
  overflow-y: auto;
  max-height: 60%;
}
.ai-console__clarify {
  padding: 12px 14px;
  border-top: 1px solid var(--cp-border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ai-clarify-q {
  font-weight: 500;
  font-size: 0.9rem;
}
.ai-options {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ai-inline-input,
.ai-console__input {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ai-console__input {
  padding: 10px 12px;
}
.ai-console__thinking {
  font-size: 0.78rem;
  color: var(--cp-text-muted, #888);
  text-align: center;
  margin-top: 6px;
}
</style>
