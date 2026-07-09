<script setup lang="ts">
// AI Operating Platform console — a full-page, generic, tool-agnostic chat
// surface over the /ai session pipeline. It renders the turn stream (user +
// assistant bubbles by kind) and a pending tool preview via the renderer registry
// (with a confirm gate). All rendering is driven by the discriminated
// `Platform*Result` shapes; no money/qty math here.
//
// A clarification is *not* a separate surface: the assistant's question is one
// more turn in the stream, and the one composer answers it. There is exactly one
// place the assistant speaks and one place you type.
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { t, te } from '@/i18n';
import PageHeader from '@/components/shared/PageHeader.vue';
import EmptyState from '@/components/shared/EmptyState.vue';
import AiChipRow from '@/components/ai/AiChipRow.vue';
import { useAiSessionStore, type AiTurn } from '@/stores/aiSession.store';
import { useConfirm } from '@/composables/useConfirm';
import { resolveRenderer } from '@/components/ai/preview/toolRenderers';
import type { PlatformClarificationResult } from '@contractor-plus/shared';

const store = useAiSessionStore();
const { turns, pending, clarification, processing, error, sessions, sessionId } = storeToRefs(store);
const { confirm: askConfirm } = useConfirm();

const input = ref('');
const scrollEl = ref<HTMLElement | null>(null);
// Vuetify forwards the native <input>, so `.focus()` lands on the real element.
const inputEl = ref<{ focus: () => void } | null>(null);

type AssistantResult = Extract<AiTurn, { role: 'assistant' }>['result'];

// Every result kind carries a human string in a different field — normalize it.
function bubbleMessage(r: AssistantResult): string {
  if (r.kind === 'clarification') return r.question;
  if (r.kind === 'preview') return r.summary;
  return r.message;
}

// Only genuinely semantic states tint the bubble. A `preview` turn is narration
// of a plan that has already been confirmed or cancelled by the time it sits in
// the scrollback, so it stays neutral — the Ochre Flag Rule reserves amber for
// the one live thing asking for attention. The store keeps `pending` and
// `clarification` mutually exclusive, so that flag is either the preview panel or
// the unanswered question — never both.
function bubbleClass(r: AssistantResult): string {
  if (r.kind === 'rejected' || r.kind === 'error') return 'ai-assistant ai-assistant--error';
  if (r.kind === 'execution') return 'ai-assistant ai-assistant--ok';
  return 'ai-assistant';
}

// The assistant waits on an answer for the newest turn only. A question further
// up the scrollback was already answered, so its options are stale: they must
// stop looking clickable, and they must stop being clickable. (Sending an answer
// pushes the user's turn first, which is what retires the question's chips.)
function isAwaiting(r: AssistantResult, i: number): r is PlatformClarificationResult {
  return (
    r.kind === 'clarification' && clarification.value !== null && i === turns.value.length - 1
  );
}

// An answer's suggestions and a live question's options are the same gesture —
// a phrase you click to say — so one row renders both.
function bubbleChips(r: AssistantResult, i: number): string[] {
  if (r.kind === 'answer') return r.suggestions ?? [];
  if (isAwaiting(r, i)) return (r.options ?? []).map((o) => o.label);
  return [];
}

function actionLabel(operation: string): string {
  return t(`ai.action.${operation}`);
}

// The backend names entities by their model name (`Customer`, `ProjectCost`).
// That is an implementation detail — show the Arabic word, and say nothing at
// all rather than leak the model name for one we haven't translated.
function entityLabel(entity: string): string | null {
  const key = `ai.entity.${entity}`;
  return te(key) ? t(key) : null;
}
function executedLabel(operation: string, entity: string): string {
  const noun = entityLabel(entity);
  return noun ? `${actionLabel(operation)} · ${noun}` : actionLabel(operation);
}

// Starter prompts double as the empty state's teaching device: they show the
// register the assistant understands rather than describing it.
const examples = computed(() => [t('ai.examples.a'), t('ai.examples.b'), t('ai.examples.c')]);

const pendingRenderer = computed(() =>
  pending.value ? resolveRenderer(pending.value.renderKind) : null,
);

// One composer serves both jobs, so it says which one it is doing right now.
const composerPlaceholder = computed(() =>
  clarification.value ? t('ai.clarify.answer') : t('ai.inputPlaceholder'),
);

function send() {
  const text = input.value;
  input.value = '';
  void store.sendMessage(text);
}

function onOption(label: string) {
  void store.sendMessage(label);
}

function dismissError() {
  error.value = null;
}

// The composer is this surface's home position. Anything that steals focus — the
// confirm dialog, a resolved preview — hands it back rather than dropping the
// caret on <body>.
async function focusComposer() {
  await nextTick();
  inputEl.value?.focus();
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
  if (ok) await store.confirm();
  // Either way the dialog took focus; return it.
  await focusComposer();
}

async function onCancel() {
  await store.cancel();
  await focusComposer();
}

// Keep the newest turn in view. Motion conveys "a turn arrived" — so it degrades
// to an instant jump when the user asks for reduced motion.
watch(
  () => turns.value.length,
  async () => {
    await nextTick();
    const el = scrollEl.value;
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
  },
);

// The dedicated answer field used to be the obvious place to type. With one
// composer, put the caret there instead — being asked a question should never
// cost a click.
watch(clarification, (c) => {
  if (c) void focusComposer();
});

onMounted(() => {
  void store.loadSessions();
});

// ----- Session switcher -----
const sessionItems = computed(() =>
  sessions.value.map((s) => ({ value: s.id, title: s.title || t('ai.untitledSession') })),
);
function onSelectSession(id: string | null) {
  if (id) void store.selectSession(id);
}
function onNewSession() {
  store.newSession();
}
// A brand-new session (created on the first message) is not yet in the list —
// refresh the switcher when the active id becomes one we don't know.
watch(sessionId, (id) => {
  if (id && !sessions.value.some((s) => s.id === id)) void store.loadSessions();
});
</script>

<template>
  <div class="ai-console">
    <PageHeader :title="t('ai.title')" icon="mdi-robot-outline" :hint="t('ai.hint')" />

    <v-card variant="outlined" class="ai-console__card">
      <div class="ai-console__bar">
        <v-select
          :model-value="sessionId"
          :items="sessionItems"
          density="compact"
          hide-details
          variant="outlined"
          :placeholder="t('ai.sessionsPlaceholder')"
          :disabled="processing"
          class="ai-console__sessions"
          @update:model-value="onSelectSession"
        />
        <v-spacer />
        <v-btn
          size="small"
          variant="tonal"
          prepend-icon="mdi-plus"
          :disabled="processing"
          @click="onNewSession"
        >
          {{ t('ai.newSession') }}
        </v-btn>
      </div>
      <v-divider />

      <div
        ref="scrollEl"
        class="ai-console__stream"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        :aria-label="t('ai.streamLabel')"
      >
        <EmptyState
          v-if="!turns.length"
          icon="mdi-robot-outline"
          :title="t('ai.emptyTitle')"
          :description="t('ai.emptyState')"
        >
          <div class="ai-examples">
            <span class="ai-examples__label">{{ t('ai.examplesLabel') }}</span>
            <AiChipRow
              :items="examples"
              align="center"
              :disabled="processing"
              @select="onOption"
            />
          </div>
        </EmptyState>

        <div v-else class="ai-thread">
          <div v-for="(turn, i) in turns" :key="i" class="ai-row" :class="turn.role">
            <div v-if="turn.role === 'user'" class="ai-bubble ai-user">
              <span class="sr-only">{{ t('ai.roleUser') }}: </span>{{ turn.text }}
            </div>
            <div
              v-else
              class="ai-bubble"
              :class="[
                bubbleClass(turn.result),
                { 'ai-assistant--asking': isAwaiting(turn.result, i) },
              ]"
            >
              <span class="sr-only">{{ t('ai.roleAssistant') }}: </span>
              <div class="ai-msg">{{ bubbleMessage(turn.result) }}</div>

              <ul
                v-if="turn.result.kind === 'execution' && turn.result.executedActions.length"
                class="ai-actions"
              >
                <li v-for="(a, j) in turn.result.executedActions" :key="j">
                  {{ executedLabel(a.operation, a.entity) }}
                </li>
              </ul>

              <!-- Capability examples, or the answers to a live question. -->
              <AiChipRow
                :items="bubbleChips(turn.result, i)"
                :disabled="processing"
                class="ai-bubble__chips"
                @select="onOption"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Docked, not in the transcript: an error must be reachable when the
           stream is empty (a failed session load) and must not scroll away.
           Outside the role="log" region, so the alert isn't a nested live area. -->
      <div v-if="error" class="ai-error" role="alert">
        <v-icon icon="mdi-alert-circle-outline" size="16" />
        <span class="ai-error__msg">{{ error }}</span>
        <v-btn
          icon="mdi-close"
          size="x-small"
          variant="text"
          :aria-label="t('ai.dismiss')"
          @click="dismissError"
        />
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

      <!-- Single activity indicator for the whole surface: the composer's own
           hairline turns into a progress rule. It is painted *over* the divider
           rather than replacing it, so nothing reflows when work starts. The
           disabled composer and the send button's spinner carry the rest. -->
      <div class="ai-console__activity">
        <v-divider />
        <v-progress-linear
          v-if="processing"
          indeterminate
          color="primary"
          height="2"
          class="ai-console__progress"
          :aria-label="t('ai.thinking')"
        />
      </div>

      <div class="ai-console__input">
        <v-text-field
          ref="inputEl"
          v-model="input"
          density="compact"
          hide-details
          variant="outlined"
          :placeholder="composerPlaceholder"
          :aria-label="composerPlaceholder"
          :disabled="processing"
          @keyup.enter="send"
        />
        <v-btn
          icon="mdi-send"
          color="primary"
          :loading="processing"
          :disabled="!input.trim()"
          :aria-label="t('ai.send')"
          @click="send"
        />
      </div>
    </v-card>
  </div>
</template>

<style scoped>
/* Fill the workspace between the top bar and the status bar. The page gutters
   (.cp-page) contribute 10px + 14px; everything else is a token, so the panel
   stays correct if the desktop chrome is retuned. */
.ai-console {
  display: flex;
  flex-direction: column;
  height: calc(100vh - var(--cp-topbar-h) - var(--cp-statusbar-h) - 24px);
}
.ai-console__card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.ai-console__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
}
.ai-console__sessions {
  max-width: 280px;
}
.ai-console__stream {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
}
/* EmptyState is the stream's only child when there are no turns — centre it. */
.ai-console__stream :deep(.cp-empty) {
  margin: auto;
}

.ai-console__activity {
  position: relative;
}
.ai-console__progress {
  position: absolute;
  inset-block-start: 0;
  inset-inline: 0;
}

/* The panel is full-bleed (desktop workspace), but the transcript is prose and
   still obeys the 65–75ch measure. */
.ai-thread {
  width: 100%;
  max-width: 72ch;
  margin-inline: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ai-examples {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}
.ai-examples__label {
  font-size: 0.78rem;
  color: var(--cp-text-muted);
}

.ai-row {
  display: flex;
}
/* Logical sides: the speaker owns the inline-end edge, the assistant the
   inline-start edge — mirrored correctly under the app's RTL default. */
.ai-row.user {
  justify-content: flex-end;
}
.ai-row.assistant {
  justify-content: flex-start;
}

.ai-bubble {
  max-width: 80%;
  padding: 9px 13px;
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius-lg);
  font-size: 0.9rem;
  line-height: 1.6;
  color: var(--cp-text);
  white-space: pre-wrap;
  /* Long unbroken tokens (ids, urls) must not blow out the column. */
  overflow-wrap: anywhere;
  text-wrap: pretty;
}
/* Blue-Is-Chrome: the speaker's turn is a *selection* tint, not a saturated
   fill. Same token as the active nav item. */
.ai-user {
  background: var(--cp-primary-soft);
  border-color: var(--cp-primary-soft);
}
.ai-assistant {
  background: var(--cp-surface-2);
}
.ai-assistant--error {
  background: var(--cp-error-soft);
  border-color: var(--cp-error-soft);
}
.ai-assistant--ok {
  background: var(--cp-success-soft);
  border-color: var(--cp-success-soft);
}
/* The Ochre Flag: the unanswered question is the one thing on screen asking for
   attention. A hairline border carries it — not a fill, and not a side stripe.
   Declared last so it wins over the neutral bubble border. */
.ai-assistant--asking {
  border-color: var(--cp-accent);
}

/* This list only ever renders inside the success-tinted execution bubble, and
   muted grey measures 4.26:1 on that tint — under AA. Keep ink; the smaller
   size carries the de-emphasis. (Never grey text on a coloured background.) */
.ai-actions {
  margin: 6px 0 0;
  padding-inline-start: 18px;
  font-size: 0.8rem;
  color: inherit;
}
.ai-bubble__chips {
  margin-top: 8px;
}

/* A docked bar across the panel, not a floating card — it reports the state of
   the whole surface. Ink on the soft tint, never grey on a colour. */
.ai-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--cp-error);
  background: var(--cp-error-soft);
  color: var(--cp-text);
  font-size: 0.84rem;
}
.ai-error__msg {
  flex: 1;
}

/* The Ochre Flag again: a pending preview is the one thing awaiting the user, so
   its hairline is the accent — the same signal the unanswered question carries.
   The store keeps the two mutually exclusive, so only ever one is lit. */
.ai-console__preview {
  padding: 12px 14px;
  border-top: 1px solid var(--cp-accent);
  overflow-y: auto;
  max-height: 60%;
}
.ai-console__input {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
}
</style>
