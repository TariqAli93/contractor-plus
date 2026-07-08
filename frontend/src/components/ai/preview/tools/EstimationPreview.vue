<script setup lang="ts">
// Tool-specific renderer for `renderKind === 'estimation'`. Presents the draft
// estimation as a read-only, reviewable preview: header facts, a read-only line
// grid, the waste %, the estimated total, and the mandatory engineer-review
// warning. Money/quantity are backend-supplied strings — nothing is computed
// here. Column style mirrors EstimationTemplateDetailView (read-only).
import { computed } from 'vue';
import { t } from '@/i18n';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';
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
const warning = computed(() => payload.value.warning || t('ai.warning'));

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
  <v-card variant="tonal" class="ai-est">
    <div class="ai-est__head">
      <v-icon size="18" class="me-1">mdi-file-chart-outline</v-icon>
      <span class="font-medium">{{ payload.templateName || t('ai.preview.title') }}</span>
    </div>

    <p v-if="preview.summary" class="ai-est__summary">{{ preview.summary }}</p>

    <v-alert type="warning" variant="tonal" density="compact" class="mb-3">
      {{ warning }}
    </v-alert>

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
        <span>{{ payload.wastePercentage }}%</span>
      </div>
    </div>

    <v-data-table
      :items="items"
      :headers="headers"
      item-value="tempId"
      :items-per-page="-1"
      hide-default-footer
      density="compact"
      class="ai-est__table"
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
      <span class="font-medium">{{ t('estimation.total') }}</span>
      <span class="font-medium text-h6">
        <MoneyDisplay :amount="payload.estimatedTotal" />
      </span>
    </div>

    <div class="ai-est__actions">
      <v-btn
        color="primary"
        variant="flat"
        size="small"
        prepend-icon="mdi-content-save-check-outline"
        :loading="busy"
        :disabled="busy"
        @click="onConfirm"
      >
        {{ t('ai.confirm') }}
      </v-btn>
      <v-btn variant="text" size="small" :disabled="busy" @click="onCancel">
        {{ t('ai.cancel') }}
      </v-btn>
    </div>
  </v-card>
</template>

<style scoped>
.ai-est {
  padding: 12px;
}
.ai-est__head {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
}
.ai-est__summary {
  font-size: 0.9rem;
  line-height: 1.6;
  margin-bottom: 10px;
}
.ai-est__facts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  margin-bottom: 10px;
  font-size: 0.85rem;
}
.ai-est__fact {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.ai-est__fact-label {
  font-size: 0.72rem;
  color: var(--cp-text-muted, #888);
}
.ai-est__table {
  margin-bottom: 10px;
}
.ai-est__total {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-bottom: 10px;
  padding-inline-end: 4px;
}
.ai-est__actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
</style>
