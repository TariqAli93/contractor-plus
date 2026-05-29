<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { t } from '@/i18n';
import { reportsApi } from '@/services/api/reports.api';
import { ApiError } from '@/types/api';
import type { CashFlowReport } from '@/types/report';
import ErrorState from '@/components/shared/ErrorState.vue';
import SummaryCard from '@/components/shared/SummaryCard.vue';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';
import DateDisplay from '@/components/shared/DateDisplay.vue';

const data = ref<CashFlowReport | null>(null);
const loading = ref(false);
const error = ref<ApiError | null>(null);

const dateFrom = ref<string | undefined>(undefined);
const dateTo = ref<string | undefined>(undefined);

async function fetch() {
  loading.value = true;
  error.value = null;
  try {
    data.value = await reportsApi.cashFlow({
      dateFrom: dateFrom.value,
      dateTo: dateTo.value,
    });
  } catch (e) {
    error.value = e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', String(e));
  } finally {
    loading.value = false;
  }
}

watch([dateFrom, dateTo], () => void fetch());
onMounted(fetch);

const netClass = computed(() => {
  const n = data.value?.netCashFlow ?? 0;
  if (n > 0) return 'text-success';
  if (n < 0) return 'text-error';
  return '';
});
</script>

<template>
  <div>
    <div class="flex items-center gap-2 mb-4">
      <v-btn icon="mdi-arrow-right" variant="text" to="/reports" />
      <h1 class="text-h5">{{ t('reports.cashFlow.title') }}</h1>
    </div>

    <v-card class="mb-4">
      <v-card-text class="flex flex-wrap items-end gap-3">
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
        <v-spacer />
        <v-btn variant="text" prepend-icon="mdi-refresh" :loading="loading" @click="fetch">
          {{ t('common.retry') }}
        </v-btn>
      </v-card-text>
    </v-card>

    <ErrorState v-if="error" :error="error" @retry="fetch" />

    <div v-else class="space-y-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <SummaryCard
          :title="t('reports.cashFlow.totalRevenue')"
          icon="mdi-cash-multiple"
          :loading="loading"
        >
          <MoneyDisplay :amount="data?.totalRevenue ?? 0" />
        </SummaryCard>
        <SummaryCard
          :title="t('reports.cashFlow.totalCollected')"
          icon="mdi-cash-check"
          :loading="loading"
        >
          <MoneyDisplay :amount="data?.totalCollected ?? 0" />
        </SummaryCard>
        <SummaryCard
          :title="t('reports.cashFlow.outstanding')"
          icon="mdi-cash-clock"
          :loading="loading"
        >
          <MoneyDisplay :amount="data?.outstandingBalance ?? 0" />
        </SummaryCard>
        <SummaryCard
          :title="t('reports.cashFlow.totalCosts')"
          icon="mdi-cash-minus"
          :loading="loading"
        >
          <MoneyDisplay :amount="data?.totalCosts ?? 0" />
        </SummaryCard>
        <SummaryCard
          :title="t('reports.cashFlow.netCashFlow')"
          icon="mdi-scale-balance"
          :loading="loading"
        >
          <span :class="netClass" class="font-medium">
            <MoneyDisplay :amount="data?.netCashFlow ?? 0" />
          </span>
        </SummaryCard>
      </div>

      <v-card v-if="data && (data.dateFrom || data.dateTo)">
        <v-card-text class="flex items-center gap-2 text-body-2 text-medium-emphasis">
          <v-icon icon="mdi-calendar-range" size="small" />
          <span>{{ t('reports.cashFlow.period') }}:</span>
          <DateDisplay :value="data.dateFrom" />
          <span>—</span>
          <DateDisplay :value="data.dateTo" />
        </v-card-text>
      </v-card>
    </div>
  </div>
</template>
