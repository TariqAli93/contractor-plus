<script setup lang="ts">
import { computed } from 'vue';
import VueApexCharts from 'vue3-apexcharts';
import type { ApexOptions } from 'apexcharts';
import { t } from '@/i18n';
import type { DashboardSummary } from '@/types/dashboard';
import { useCurrencyFormat } from '@/composables/useCurrencyFormat';
import { useThemeStore } from '@/stores/theme.store';

const props = defineProps<{
  summary: DashboardSummary | null;
  loading: boolean;
}>();

const { format } = useCurrencyFormat();
const theme = useThemeStore();

// Money fields arrive as fixed-precision strings (see lib/money.ts). Coerce to
// number only here, at the charting boundary.
const num = (value: string | null | undefined): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const series = computed(() => [
  {
    name: t('dashboard.financialChart.amount'),
    data: [
      num(props.summary?.monthlyRevenue),
      num(props.summary?.monthlyCosts),
      num(props.summary?.monthlyProfit),
      num(props.summary?.totalCashCollected),
      num(props.summary?.pendingCollections),
    ],
  },
]);

// Profit turns red when negative; the rest keep their semantic brand colors
// (revenue=info, costs=warning, collected=primary, pending=accent).
const colors = computed(() => [
  '#0284C7',
  '#F59E0B',
  num(props.summary?.monthlyProfit) < 0 ? '#DC2626' : '#16A34A',
  '#1E5F8C',
  '#D97706',
]);

const options = computed<ApexOptions>(() => ({
  chart: {
    type: 'bar',
    fontFamily: 'inherit',
    background: 'transparent',
    toolbar: { show: false },
    animations: { speed: 400 },
  },
  theme: { mode: theme.isDark ? 'dark' : 'light' },
  colors: colors.value,
  plotOptions: {
    bar: { distributed: true, borderRadius: 6, columnWidth: '55%' },
  },
  dataLabels: { enabled: false },
  legend: { show: false },
  grid: {
    borderColor: theme.isDark ? '#334155' : '#e3e8ef',
    strokeDashArray: 4,
  },
  xaxis: {
    categories: [
      t('dashboard.metrics.monthlyRevenue'),
      t('dashboard.metrics.monthlyCosts'),
      t('dashboard.metrics.monthlyProfit'),
      t('dashboard.metrics.cashCollected'),
      t('dashboard.metrics.pendingCollections'),
    ],
    axisBorder: { show: false },
    axisTicks: { show: false },
    labels: { style: { fontSize: '12px' } },
  },
  yaxis: {
    // RTL: keep the value axis on the right-hand side.
    opposite: true,
    labels: { formatter: (value: number) => format(value, { hideSymbol: true }) },
  },
  tooltip: {
    theme: theme.isDark ? 'dark' : 'light',
    y: { formatter: (value: number) => format(value) },
  },
  states: { hover: { filter: { type: 'lighten', value: 0.05 } } },
}));
</script>

<template>
  <v-card variant="outlined">
    <v-card-title class="text-subtitle-1 font-medium">
      {{ t('dashboard.financialChart.title') }}
    </v-card-title>
    <v-divider />
    <v-card-text>
      <v-skeleton-loader v-if="loading" type="image" class="cp-chart-skeleton" />
      <VueApexCharts v-else type="bar" height="300" :options="options" :series="series" />
    </v-card-text>
  </v-card>
</template>

<style scoped>
.cp-chart-skeleton {
  height: 300px;
}
</style>
