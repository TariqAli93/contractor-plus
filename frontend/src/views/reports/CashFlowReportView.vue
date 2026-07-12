<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { t } from '@/i18n';
import { reportsApi } from '@/services/api/reports.api';
import { ApiError } from '@/types/api';
import type { CashFlowReport } from '@/types/report';
import ErrorState from '@/components/shared/ErrorState.vue';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';
import DateDisplay from '@/components/shared/DateDisplay.vue';
import PageHeader from '@/components/shared/PageHeader.vue';
import AiNarrativeCard from '@/components/features/reports/AiNarrativeCard.vue';

const data = ref<CashFlowReport | null>(null);
const loading = ref(false);
const error = ref<ApiError | null>(null);
const dateFrom = ref<string | undefined>(undefined);
const dateTo = ref<string | undefined>(undefined);

async function fetch() {
  loading.value = true;
  error.value = null;
  try {
    data.value = await reportsApi.cashFlow({ dateFrom: dateFrom.value, dateTo: dateTo.value });
  } catch (e) {
    error.value = e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', String(e));
  } finally {
    loading.value = false;
  }
}

watch([dateFrom, dateTo], () => void fetch());
onMounted(fetch);

const netClass = computed(() => {
  const n = Number(data.value?.netCashFlow ?? 0);
  return n > 0 ? 'text-success' : n < 0 ? 'text-error' : '';
});

// Same filters the numeric report is showing — empty strings are dropped so
// the narrative endpoint's date coercion never sees them.
const narrativeFilters = computed(() => ({
  ...(dateFrom.value ? { dateFrom: dateFrom.value } : {}),
  ...(dateTo.value ? { dateTo: dateTo.value } : {}),
}));

const metrics = computed(() => [
  { key: 'revenue', label: t('reports.cashFlow.totalRevenue'), icon: 'mdi-cash-multiple', amount: data.value?.totalRevenue ?? 0 },
  { key: 'collected', label: t('reports.cashFlow.totalCollected'), icon: 'mdi-cash-check', amount: data.value?.totalCollected ?? 0 },
  { key: 'outstanding', label: t('reports.cashFlow.outstanding'), icon: 'mdi-cash-clock', amount: data.value?.outstandingBalance ?? 0 },
  { key: 'costs', label: t('reports.cashFlow.totalCosts'), icon: 'mdi-cash-minus', amount: data.value?.totalCosts ?? 0 },
  { key: 'net', label: t('reports.cashFlow.netCashFlow'), icon: 'mdi-scale-balance', amount: data.value?.netCashFlow ?? 0 },
]);
</script>

<template>
  <div class="cp-fill">
    <PageHeader :title="t('reports.cashFlow.title')" back="/reports" />

    <section class="cp-pane">
      <div class="cp-pane__toolbar cp-cash-flow__filters">
        <v-text-field
          v-model="dateFrom"
          :label="t('reports.cashFlow.dateFrom')"
          type="date"
          density="compact"
          hide-details
          style="max-width: 200px"
        />
        <v-text-field
          v-model="dateTo"
          :label="t('reports.cashFlow.dateTo')"
          type="date"
          density="compact"
          hide-details
          style="max-width: 200px"
        />
        <v-btn variant="text" prepend-icon="mdi-refresh" :loading="loading" @click="fetch">
          {{ t('common.retry') }}
        </v-btn>
      </div>

      <ErrorState v-if="error" :error="error" class="ma-3" @retry="fetch" />

      <div v-else class="cp-pane__body cp-cash-flow__body">
        <v-table class="cp-cash-flow__table">
          <thead>
            <tr>
              <th>{{ t('reports.cashFlow.title') }}</th>
              <th class="text-end">{{ t('payments.fields.amount') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="metric in metrics" :key="metric.key">
              <td>
                <span class="cp-cash-flow__label">
                  <v-icon :icon="metric.icon" size="16" />
                  {{ metric.label }}
                </span>
              </td>
              <td class="text-end font-weight-medium" :class="metric.key === 'net' ? netClass : ''">
                <MoneyDisplay :amount="metric.amount" />
              </td>
            </tr>
          </tbody>
        </v-table>

        <div v-if="data && (data.dateFrom || data.dateTo)" class="cp-cash-flow__period">
          <v-icon icon="mdi-calendar-range" size="16" />
          <span>{{ t('reports.cashFlow.period') }}:</span>
          <DateDisplay :value="data.dateFrom" />
          <span>-</span>
          <DateDisplay :value="data.dateTo" />
        </div>
      </div>
    </section>

    <AiNarrativeCard v-if="!error" report-type="cash-flow" :filters="narrativeFilters" />
  </div>
</template>

<style scoped>
.cp-cash-flow__filters { flex-wrap: wrap; }
.cp-cash-flow__filters .v-btn { margin-inline-start: auto; }
.cp-cash-flow__body { overflow: auto; }
.cp-cash-flow__table { max-width: 680px; }
.cp-cash-flow__label,
.cp-cash-flow__period { display: inline-flex; align-items: center; gap: 6px; }
.cp-cash-flow__period {
  min-height: 30px;
  padding: 4px 8px;
  color: var(--cp-text-muted);
  background: var(--cp-surface-2);
  border-block-start: 1px solid var(--cp-border);
  font-size: 0.76rem;
}
</style>
