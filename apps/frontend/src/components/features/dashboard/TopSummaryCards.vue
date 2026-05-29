<script setup lang="ts">
import { computed } from 'vue';
import { t } from '@/i18n';
import type { DashboardSummary } from '@/types/dashboard';
import SummaryMetricCard from './SummaryMetricCard.vue';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';

const props = defineProps<{
  summary: DashboardSummary | null;
  loading: boolean;
}>();

const delayedTone = computed<'neutral' | 'attention'>(() =>
  (props.summary?.delayedProjects ?? 0) > 0 ? 'attention' : 'neutral',
);
const overdueTone = computed<'neutral' | 'urgent'>(() =>
  (props.summary?.overduePayments ?? 0) > 0 ? 'urgent' : 'neutral',
);
</script>

<template>
  <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
    <SummaryMetricCard
      :title="t('dashboard.metrics.activeProjects')"
      :value="summary?.activeProjects"
      icon="mdi-office-building-outline"
      tone="neutral"
      :loading="loading"
    />
    <SummaryMetricCard
      :title="t('dashboard.metrics.delayedProjects')"
      :value="summary?.delayedProjects"
      icon="mdi-clock-alert-outline"
      :tone="delayedTone"
      :loading="loading"
    />
    <SummaryMetricCard
      :title="t('dashboard.metrics.overduePayments')"
      :value="summary?.overduePayments"
      icon="mdi-cash-remove"
      :tone="overdueTone"
      :loading="loading"
    />
    <SummaryMetricCard
      :title="t('dashboard.metrics.pendingCollections')"
      icon="mdi-cash-clock"
      tone="neutral"
      :loading="loading"
    >
      <MoneyDisplay :amount="summary?.pendingCollections ?? null" />
    </SummaryMetricCard>
  </div>
</template>
