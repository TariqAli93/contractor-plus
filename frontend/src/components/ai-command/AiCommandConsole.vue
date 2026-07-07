<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useAiCommandStore, type AiTurn } from '@/stores/aiCommand.store';
import { useAuthStore } from '@/stores/auth.store';

const store = useAiCommandStore();
const { open, processing, turns, pending, error, insights } = storeToRefs(store);

const auth = useAuthStore();
const canUse = computed(() => auth.isOwner || auth.permissions.includes('ai.use'));

const input = ref('');
const scrollEl = ref<HTMLElement | null>(null);

function send() {
  const text = input.value;
  input.value = '';
  void store.submit(text);
}

type Result = Extract<AiTurn, { role: 'assistant' }>['result'];

function message(r: Result): string {
  return r.kind === 'workflow_plan' ? r.confirmationMessage : r.message;
}

function bubbleClass(r: Result): string {
  if (r.kind === 'rejected') return 'ai-assistant ai-assistant--error';
  if (r.kind === 'execution') return 'ai-assistant ai-assistant--ok';
  if (r.kind === 'workflow_plan') return 'ai-assistant ai-assistant--plan';
  return 'ai-assistant';
}

interface Financials {
  contractValue?: string | null;
  totalPaid?: string;
  totalCosts?: string;
  remainingBalance?: string | null;
  progressPercentage?: number;
}
function financials(r: Result): Financials | null {
  if (r.kind !== 'query') return null;
  const d = r.data as { financials?: Financials } | null;
  return d?.financials ?? null;
}

interface Row {
  label: string;
  sub?: string;
}
/** Best-effort rows for list-shaped query results (overdue payments, delayed
 *  projects, profitability, paginated lists). */
function queryList(r: Result): Row[] | null {
  if (r.kind !== 'query' || financials(r)) return null;
  const d = r.data as unknown;
  const arr: unknown[] | null = Array.isArray(d)
    ? d
    : Array.isArray((d as { items?: unknown[] })?.items)
      ? (d as { items: unknown[] }).items
      : null;
  if (!arr) return null;
  return arr.slice(0, 6).map((row) => {
    const o = row as Record<string, unknown>;
    const label = (o.customerName ?? o.name ?? o.projectName ?? o.contractNumber ?? o.description ?? '—') as string;
    const sub = (o.totalOverdueAmount ?? o.contractValue ?? o.amount ?? o.profit ?? o.status ?? undefined) as
      | string
      | undefined;
    return { label: String(label), sub: sub !== undefined ? String(sub) : undefined };
  });
}

watch(
  () => turns.value.length,
  async () => {
    await nextTick();
    if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight;
  },
);
</script>

<template>
  <template v-if="canUse">
    <v-btn
      class="ai-fab"
      icon="mdi-robot-outline"
      color="primary"
      size="large"
      elevation="6"
      :aria-label="'مساعد الأوامر الذكي'"
      @click="store.toggle()"
    />

    <v-card v-if="open" class="ai-panel" elevation="12">
      <div class="ai-panel__head">
        <div class="flex items-center gap-2">
          <v-icon icon="mdi-robot-outline" size="20" />
          <span class="font-medium">مساعد الأوامر الذكي</span>
        </div>
        <div>
          <v-btn size="x-small" variant="text" icon="mdi-broom" title="مسح المحادثة" @click="store.reset()" />
          <v-btn size="x-small" variant="text" icon="mdi-close" title="إغلاق" @click="store.toggle()" />
        </div>
      </div>

      <div ref="scrollEl" class="ai-panel__body">
        <div v-if="insights" class="ai-brief">{{ insights.message }}</div>

        <div v-if="!turns.length" class="ai-empty">
          اكتب أمرك بلغتك الطبيعية، مثال:<br />
          «سويلي مشروع باسم محمد احمد مساحة 200 متر»
        </div>

        <div v-for="(turn, i) in turns" :key="i" class="ai-row" :class="turn.role">
          <div v-if="turn.role === 'user'" class="ai-bubble ai-user">{{ turn.text }}</div>
          <div v-else class="ai-bubble" :class="bubbleClass(turn.result)">
            <div class="ai-msg">{{ message(turn.result) }}</div>

            <ul v-if="turn.result.kind === 'workflow_plan'" class="ai-steps">
              <li v-for="(s, j) in turn.result.steps" :key="j">{{ s.action }}</li>
            </ul>

            <div
              v-if="turn.result.kind === 'clarification' && turn.result.options?.length"
              class="ai-options"
            >
              <v-chip
                v-for="o in turn.result.options"
                :key="o.id"
                size="small"
                variant="tonal"
                @click="store.submit(o.label)"
              >
                {{ o.label }}
              </v-chip>
            </div>

            <div v-if="financials(turn.result)" class="ai-summary">
              <div><span>قيمة العقد:</span> {{ financials(turn.result)?.contractValue ?? '—' }}</div>
              <div><span>المستلم:</span> {{ financials(turn.result)?.totalPaid ?? '—' }}</div>
              <div><span>المصاريف:</span> {{ financials(turn.result)?.totalCosts ?? '—' }}</div>
              <div><span>المتبقي:</span> {{ financials(turn.result)?.remainingBalance ?? '—' }}</div>
              <div><span>الإنجاز:</span> {{ financials(turn.result)?.progressPercentage ?? 0 }}%</div>
            </div>

            <div v-if="queryList(turn.result)" class="ai-list">
              <div v-for="(row, k) in queryList(turn.result)" :key="k" class="ai-list-row">
                <span class="ai-list-label">{{ row.label }}</span>
                <span v-if="row.sub" class="ai-list-sub">{{ row.sub }}</span>
              </div>
              <div v-if="!queryList(turn.result)?.length" class="ai-list-empty">لا توجد نتائج.</div>
            </div>
          </div>
        </div>

        <div v-if="error" class="ai-error">{{ error }}</div>
      </div>

      <div v-if="pending" class="ai-confirm">
        <v-btn color="primary" size="small" :loading="processing" @click="store.confirm()">تأكيد</v-btn>
        <v-btn variant="text" size="small" :disabled="processing" @click="store.cancel()">إلغاء</v-btn>
      </div>

      <div class="ai-panel__input">
        <v-text-field
          v-model="input"
          density="compact"
          hide-details
          variant="solo-filled"
          flat
          placeholder="اكتب أمرك…"
          :disabled="processing"
          @keyup.enter="send"
        />
        <v-btn icon="mdi-send" color="primary" :loading="processing" @click="send" />
      </div>
    </v-card>
  </template>
</template>

<style scoped>
.ai-fab {
  position: fixed;
  inset-block-end: 52px;
  inset-inline-end: 16px;
  z-index: 2000;
}
.ai-panel {
  position: fixed;
  inset-block-end: 116px;
  inset-inline-end: 16px;
  width: min(420px, calc(100vw - 32px));
  height: min(560px, calc(100vh - 180px));
  display: flex;
  flex-direction: column;
  z-index: 2000;
  border-radius: 14px;
  overflow: hidden;
}
.ai-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--cp-border);
  background: var(--cp-surface, transparent);
}
.ai-panel__body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ai-empty {
  color: var(--cp-text-muted, #888);
  font-size: 0.85rem;
  text-align: center;
  margin: auto;
  line-height: 1.9;
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
  max-width: 85%;
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 0.9rem;
  line-height: 1.6;
  white-space: pre-wrap;
}
.ai-user {
  background: var(--cp-primary, #1976d2);
  color: #fff;
}
.ai-assistant {
  background: var(--cp-surface-2, rgba(128, 128, 128, 0.12));
}
.ai-assistant--error {
  background: rgba(211, 47, 47, 0.12);
}
.ai-assistant--ok {
  background: rgba(56, 142, 60, 0.14);
}
.ai-assistant--plan {
  background: rgba(255, 167, 38, 0.14);
}
.ai-steps {
  margin: 6px 0 0;
  padding-inline-start: 18px;
  font-size: 0.8rem;
  opacity: 0.85;
}
.ai-options {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.ai-summary {
  margin-top: 8px;
  display: grid;
  gap: 2px;
  font-size: 0.82rem;
}
.ai-summary span {
  color: var(--cp-text-muted, #888);
}
.ai-brief {
  background: rgba(25, 118, 210, 0.1);
  border: 1px solid rgba(25, 118, 210, 0.25);
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 0.82rem;
  line-height: 1.6;
}
.ai-list {
  margin-top: 8px;
  display: grid;
  gap: 3px;
  font-size: 0.82rem;
}
.ai-list-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  border-bottom: 1px dashed var(--cp-border);
  padding-bottom: 2px;
}
.ai-list-sub {
  color: var(--cp-text-muted, #888);
  white-space: nowrap;
}
.ai-list-empty {
  color: var(--cp-text-muted, #888);
}
.ai-error {
  color: rgb(211, 47, 47);
  font-size: 0.82rem;
  text-align: center;
}
.ai-confirm {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--cp-border);
}
.ai-panel__input {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-top: 1px solid var(--cp-border);
}
</style>
