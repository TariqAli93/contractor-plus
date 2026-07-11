<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import VueApexCharts from 'vue3-apexcharts';
import type { ApexOptions } from 'apexcharts';
import { t } from '@/i18n';
import type { DashboardSummary } from '@/types/dashboard';
import { useCurrencyFormat } from '@/composables/useCurrencyFormat';

const props = defineProps<{
  summary: DashboardSummary | null;
  loading: boolean;
}>();

const { format } = useCurrencyFormat();

// ApexCharts paints SVG presentation attributes, which do not resolve CSS
// custom properties - so the palette has to be read out of the cascade as
// concrete values. Reading it from our own element keeps the chart aligned with
// the same locked palette used by the surrounding workspace.
const rootEl = ref<HTMLElement | null>(null);

function token(name: string, fallback: string): string {
  const host = rootEl.value;
  if (!host) return fallback;
  return getComputedStyle(host).getPropertyValue(name).trim() || fallback;
}

// Motion here is JS-driven inside Apex's SVG, so the global CSS
// `prefers-reduced-motion` guard in main.css cannot reach it.
const reduceMotion = ref(false);
let motionQuery: MediaQueryList | undefined;
const onMotionChange = (e: MediaQueryListEvent) => {
  reduceMotion.value = e.matches;
};

onMounted(() => {
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  reduceMotion.value = motionQuery.matches;
  motionQuery.addEventListener('change', onMotionChange);
});

onUnmounted(() => {
  motionQuery?.removeEventListener('change', onMotionChange);
});

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
  token('--cp-info', '#234E70'),
  token('--cp-warning', '#B7791F'),
  num(props.summary?.monthlyProfit) < 0
    ? token('--cp-error', '#C53030')
    : token('--cp-success', '#2F855A'),
  token('--cp-primary', '#234E70'),
  token('--cp-accent', '#B7791F'),
]);

const options = computed<ApexOptions>(() => ({
  chart: {
    type: 'bar',
    fontFamily: 'inherit',
    background: 'transparent',
    toolbar: { show: false },
    animations: { enabled: !reduceMotion.value, speed: 180 },
  },
  colors: colors.value,
  plotOptions: {
    // 3px == --cp-radius-sm; the crisp low radius the rest of the app uses.
    bar: { distributed: true, borderRadius: 3, columnWidth: '55%' },
  },
  dataLabels: { enabled: false },
  legend: { show: false },
  grid: {
    borderColor: token('--cp-border', '#CBD5E0'),
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
  tooltip: { y: { formatter: (value: number) => format(value) } },
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
      <!-- A real DOM node, so the palette can be read out of the themed
           cascade. It wraps both branches so it exists before the chart does. -->
      <div ref="rootEl">
        <v-skeleton-loader v-if="loading" type="image" class="cp-chart-skeleton" />
        <VueApexCharts v-else type="bar" height="300" :options="options" :series="series" />
      </div>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.cp-chart-skeleton {
  height: 300px;
}
</style>
