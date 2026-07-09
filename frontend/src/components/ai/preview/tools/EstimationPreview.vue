<script setup lang="ts">
// Tool-specific renderer for `renderKind === 'estimation'`. Presents the draft
// estimation as a read-only, reviewable preview: header facts, a read-only line
// grid, the waste %, the estimated total, and the mandatory engineer-review
// warning. Money/quantity are backend-supplied strings — nothing is computed
// here. Column style mirrors EstimationTemplateDetailView (read-only).
//
// The panel chrome (header, summary, warnings, confirm/cancel) belongs to
// AiPreviewPanel; only the estimation body lives here.
import { computed } from 'vue';
import { t } from '@/i18n';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';
import AiPreviewPanel from '../AiPreviewPanel.vue';
import type { EstimationDraftItem, PlatformPreviewResult } from '@contractor-plus/shared';

// The estimation payload shape carried by a `preview` result with
// renderKind 'estimation' (see the platform protocol docs).
interface EstimationPreviewPayload {
  draftId: string;
  templateName: string;
  status: string;
  projectType: string | null;
  areaValue: string | null;
  areaUnit: string | null;
  wastePercentage: string;
  estimatedTotal: string;
  warning: string;
  items: EstimationDraftItem[];
}

const props = defineProps<{ preview: PlatformPreviewResult; busy?: boolean }>();
const emit = defineEmits<{ (e: 'confirm'): void; (e: 'cancel'): void }>();

const payload = computed(() => props.preview.payload as EstimationPreviewPayload);
const items = computed<EstimationDraftItem[]>(() => payload.value.items ?? []);
const areaLabel = computed(() =>
  payload.value.areaValue
    ? `${payload.value.areaValue} ${payload.value.areaUnit ?? ''}`.trim()
    : '—',
);
// The engineer-review warning is mandatory: fall back to the generic copy rather
// than let a payload without one render an unwarned estimate.
const warnings = computed<string[]>(() => [payload.value.warning || t('ai.warning')]);

const headers = computed(() => [
  { title: t('estimation.columns.description'), key: 'description' },
  { title: t('estimation.columns.category'), key: 'category' },
  { title: t('estimation.columns.quantity'), key: 'quantity', align: 'end' as const },
  { title: t('estimation.columns.unit'), key: 'unit' },
  { title: t('estimation.columns.unitPrice'), key: 'unitPrice', align: 'end' as const },
  { title: t('estimation.columns.total'), key: 'totalAmount', align: 'end' as const },
]);

function categoryLabel(category: string): string {
  return t(`estimation.category.${category}`);
}

function onConfirm() {
  emit('confirm');
}
function onCancel() {
  emit('cancel');
}
</script>

<template>
  <AiPreviewPanel
    :title="payload.templateName || t('ai.preview.title')"
    icon="mdi-file-chart-outline"
    :summary="preview.summary"
    :warnings="warnings"
    :busy="busy"
    confirm-icon="mdi-content-save-check-outline"
    @confirm="onConfirm"
    @cancel="onCancel"
  >
    <div class="ai-est__facts">
      <div class="ai-est__fact">
        <span class="ai-est__fact-label">{{ t('estimation.listColumns.projectType') }}</span>
        <span>{{ payload.projectType ?? '—' }}</span>
      </div>
      <div class="ai-est__fact">
        <span class="ai-est__fact-label">{{ t('estimation.listColumns.area') }}</span>
        <span>{{ areaLabel }}</span>
      </div>
      <div class="ai-est__fact">
        <span class="ai-est__fact-label">{{ t('estimation.waste') }}</span>
        <span class="ai-est__fact-value">{{ payload.wastePercentage }}%</span>
      </div>
    </div>

    <v-data-table
      :items="items"
      :headers="headers"
      item-value="tempId"
      :items-per-page="-1"
      hide-default-footer
      density="compact"
    >
      <template #[`item.category`]="{ item }">{{ categoryLabel(item.category) }}</template>
      <template #[`item.quantity`]="{ item }">{{ item.quantity ?? '—' }}</template>
      <template #[`item.unit`]="{ item }">{{ item.unit ?? '—' }}</template>
      <template #[`item.unitPrice`]="{ item }">
        <MoneyDisplay v-if="item.unitPrice" :amount="item.unitPrice" />
        <span v-else>—</span>
      </template>
      <template #[`item.totalAmount`]="{ item }">
        <MoneyDisplay :amount="item.totalAmount" />
      </template>
    </v-data-table>

    <div class="ai-est__total">
      <span class="ai-est__total-label">{{ t('estimation.total') }}</span>
      <span class="ai-est__total-amount"><MoneyDisplay :amount="payload.estimatedTotal" /></span>
    </div>
  </AiPreviewPanel>
</template>

<style scoped>
.ai-est__facts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  font-size: 0.85rem;
}
.ai-est__fact {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
/* Muted ink clears AA only because AiPreviewPanel is untinted (4.76:1). */
.ai-est__fact-label {
  font-size: 0.72rem;
  color: var(--cp-text-muted);
}
/* A figure, so it aligns and doesn't jitter — The Tabular Numerals Rule. */
.ai-est__fact-value {
  font-variant-numeric: tabular-nums;
}
.ai-est__total {
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 12px;
  padding-inline-end: 4px;
}
.ai-est__total-label {
  font-weight: 500;
}
.ai-est__total-amount {
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: -0.02em;
}
</style>
