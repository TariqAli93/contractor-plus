<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { t } from '@/i18n';
import { useTemplateEstimate } from '@/composables/useTemplateEstimate';
import SummaryCard from '@/components/shared/SummaryCard.vue';
import ErrorState from '@/components/shared/ErrorState.vue';
import EmptyState from '@/components/shared/EmptyState.vue';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';
import DataTable from '@/components/shared/DataTable.vue';

const props = defineProps<{ templateId: string }>();

const { data, loading, error, fetch } = useTemplateEstimate(props.templateId);

const materialHeaders = computed(() => [
  { key: 'materialName', title: t('templates.items.fields.material'), sortable: true },
  { key: 'unit', title: t('templates.items.fields.unit'), sortable: true, width: 90 },
  { key: 'estimatedQuantity', title: t('templates.items.fields.quantityPer100m2'), sortable: true, align: 'end' as const, width: 180 },
  { key: 'estimatedPrice', title: t('templates.items.fields.estimatedPrice'), sortable: true, align: 'end' as const, width: 160 },
]);
const stepHeaders = computed(() => [
  { key: 'sortOrder', title: t('templates.steps.fields.sortOrder'), sortable: true, align: 'end' as const, width: 90 },
  { key: 'name', title: t('templates.steps.fields.name'), sortable: true },
  { key: 'percentage', title: t('templates.steps.fields.percentage'), sortable: true, align: 'end' as const, width: 130 },
  { key: 'estimatedDays', title: t('templates.steps.fields.estimatedDays'), sortable: true, align: 'end' as const, width: 130 },
]);

onMounted(fetch);
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-h6">{{ t('templates.estimate.title') }}</h2>
      <v-btn
        variant="tonal"
        prepend-icon="mdi-refresh"
        :loading="loading"
        @click="fetch"
      >
        {{ t('common.retry') }}
      </v-btn>
    </div>

    <ErrorState v-if="error" :error="error" class="my-4" @retry="fetch" />

    <template v-else-if="data">
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <SummaryCard
          :title="t('templates.estimate.fields.materialCost')"
          icon="mdi-cube-outline"
          :loading="loading"
        >
          <MoneyDisplay :amount="data.estimatedMaterialCost" />
        </SummaryCard>
        <SummaryCard
          :title="t('templates.estimate.fields.profitMargin')"
          icon="mdi-chart-line"
          :loading="loading"
        >
          {{ data.suggestedProfitMargin !== null ? `${data.suggestedProfitMargin}%` : '-' }}
        </SummaryCard>
        <SummaryCard
          :title="t('templates.estimate.fields.profitAmount')"
          icon="mdi-cash-plus"
          :loading="loading"
        >
          <MoneyDisplay :amount="data.estimatedProfitAmount" />
        </SummaryCard>
        <SummaryCard
          :title="t('templates.estimate.fields.sellingPrice')"
          icon="mdi-tag-outline"
          :loading="loading"
        >
          <MoneyDisplay :amount="data.estimatedSellingPrice" />
        </SummaryCard>
        <SummaryCard
          :title="t('templates.estimate.fields.durationDays')"
          icon="mdi-calendar-clock"
          :loading="loading"
        >
          {{ data.estimatedDurationDays ?? '-' }}
        </SummaryCard>
        <SummaryCard
          :title="t('templates.estimate.fields.stepsPercentage')"
          icon="mdi-percent-outline"
          :loading="loading"
        >
          {{ data.summary.totalStepsPercentage }}%
        </SummaryCard>
        <SummaryCard
          :title="t('templates.estimate.fields.itemCount')"
          icon="mdi-format-list-bulleted"
          :loading="loading"
        >
          {{ data.summary.itemCount }}
        </SummaryCard>
        <SummaryCard
          :title="t('templates.estimate.fields.stepCount')"
          icon="mdi-format-list-numbered"
          :loading="loading"
        >
          {{ data.summary.stepCount }}
        </SummaryCard>
      </div>

      <section class="cp-panel cp-estimate-table">
        <h3 class="cp-estimate-table__title">{{ t('templates.estimate.materialsBreakdown') }}</h3>
        <DataTable
          :items="data.materials"
          :items-length="data.materials.length"
          :headers="materialHeaders"
          :items-per-page="-1"
          :server="false"
          item-value="itemId"
          hide-default-footer
        >
          <template #[`item.estimatedPrice`]="{ item }"><MoneyDisplay :amount="item.estimatedPrice" /></template>
        </DataTable>
        <EmptyState
          v-if="data.materials.length === 0"
          :title="t('templates.items.empty')"
          icon="mdi-package-variant"
        />
      </section>

      <section class="cp-panel cp-estimate-table">
        <h3 class="cp-estimate-table__title">{{ t('templates.estimate.stepsSummary') }}</h3>
        <DataTable
          :items="data.steps"
          :items-length="data.steps.length"
          :headers="stepHeaders"
          :items-per-page="-1"
          :server="false"
          item-value="id"
          hide-default-footer
        >
          <template #[`item.percentage`]="{ item }">{{ item.percentage }}%</template>
          <template #[`item.estimatedDays`]="{ item }">{{ item.estimatedDays ?? '-' }}</template>
        </DataTable>
        <EmptyState
          v-if="data.steps.length === 0"
          :title="t('templates.steps.empty')"
          icon="mdi-format-list-numbered"
        />
      </section>
    </template>

    <v-progress-linear v-else indeterminate />
  </div>
</template>

<style scoped>
.cp-estimate-table { margin-bottom: 6px; overflow: hidden; }
.cp-estimate-table__title {
  margin: 0;
  padding: 6px 8px;
  color: var(--cp-text);
  background: var(--cp-surface-2);
  border-block-end: 1px solid var(--cp-border);
  font-size: 0.8rem;
  font-weight: 600;
}
.cp-estimate-table :deep(.cp-smart-table) { height: auto; max-height: 340px; }
</style>
