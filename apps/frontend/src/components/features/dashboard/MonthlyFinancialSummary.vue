<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { DashboardSummary } from '@/types/dashboard';
import SummaryMetricCard from './SummaryMetricCard.vue';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';

const props = defineProps<{
  summary: DashboardSummary | null;
  loading: boolean;
}>();

const { t } = useI18n();

const profitTone = computed<'positive' | 'urgent' | 'neutral'>(() => {
  const v = props.summary?.monthlyProfit;
  if (v === undefined || v === null) return 'neutral';
  if (v < 0) return 'urgent';
  if (v > 0) return 'positive';
  return 'neutral';
});
</script>

<template>
  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
    <SummaryMetricCard
      :title="t('dashboard.metrics.monthlyRevenue')"
      icon="mdi-cash-plus"
      :loading="loading"
    >
      <MoneyDisplay :amount="summary?.monthlyRevenue ?? null" />
    </SummaryMetricCard>
    <SummaryMetricCard
      :title="t('dashboard.metrics.monthlyCosts')"
      icon="mdi-cash-minus"
      :loading="loading"
    >
      <MoneyDisplay :amount="summary?.monthlyCosts ?? null" />
    </SummaryMetricCard>
    <SummaryMetricCard
      :title="t('dashboard.metrics.monthlyProfit')"
      icon="mdi-chart-line"
      :tone="profitTone"
      :loading="loading"
    >
      <MoneyDisplay :amount="summary?.monthlyProfit ?? null" />
    </SummaryMetricCard>
    <SummaryMetricCard
      :title="t('dashboard.metrics.cashCollected')"
      icon="mdi-bank-outline"
      tone="positive"
      :loading="loading"
    >
      <MoneyDisplay :amount="summary?.totalCashCollected ?? null" />
    </SummaryMetricCard>
  </div>
</template>
