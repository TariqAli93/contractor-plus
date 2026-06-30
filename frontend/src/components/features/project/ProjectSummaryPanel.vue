<script setup lang="ts">
import { computed } from 'vue';
import { t } from '@/i18n';
import type { ProjectWithContract } from '@/types/project';
import type { ProjectCostSummary } from '@/types/cost';
import type { ProjectPaymentSummary } from '@/types/payment';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';

const props = defineProps<{
  project: ProjectWithContract;
  costSummary: ProjectCostSummary | null;
  paymentSummary: ProjectPaymentSummary | null;
}>();

const contractValue = computed<string | null>(
  () => props.paymentSummary?.contractTotal ?? null,
);

// Coerced to number for the local derived estimates below. The authoritative,
// Decimal-precise profit/cash figures come from the profitability report; these
// panel values are display-only conveniences, so a Number() coercion is fine.
const totalCosts = computed(() => Number(props.costSummary?.totalCosts ?? 0));
const totalPaid = computed(() => Number(props.paymentSummary?.totalPaid ?? 0));

const profitEstimate = computed(() =>
  contractValue.value !== null ? Number(contractValue.value) - totalCosts.value : null,
);
const cashPosition = computed(() => totalPaid.value - totalCosts.value);
const remainingBalance = computed(() => props.paymentSummary?.remainingBalance ?? null);
</script>

<template>
  <v-card variant="outlined">
    <v-card-title class="text-subtitle-1 font-medium">
      {{ t('projects.summary.title') }}
    </v-card-title>
    <v-divider />
    <v-list density="compact">
      <v-list-item>
        <template #prepend><v-icon icon="mdi-file-sign" /></template>
        <v-list-item-title>{{ t('projects.summary.contractValue') }}</v-list-item-title>
        <template #append><MoneyDisplay :amount="contractValue" /></template>
      </v-list-item>
      <v-list-item>
        <template #prepend><v-icon icon="mdi-cash-minus" /></template>
        <v-list-item-title>{{ t('projects.summary.totalCosts') }}</v-list-item-title>
        <template #append><MoneyDisplay :amount="totalCosts" /></template>
      </v-list-item>
      <v-list-item>
        <template #prepend><v-icon icon="mdi-cash-plus" /></template>
        <v-list-item-title>{{ t('projects.summary.totalPaid') }}</v-list-item-title>
        <template #append><MoneyDisplay :amount="totalPaid" /></template>
      </v-list-item>
      <v-list-item>
        <template #prepend><v-icon icon="mdi-cash-clock" /></template>
        <v-list-item-title>{{ t('projects.summary.remainingBalance') }}</v-list-item-title>
        <template #append><MoneyDisplay :amount="remainingBalance" /></template>
      </v-list-item>
      <v-divider />
      <v-list-item>
        <template #prepend><v-icon icon="mdi-chart-line" /></template>
        <v-list-item-title>{{ t('projects.summary.profitEstimate') }}</v-list-item-title>
        <template #append>
          <span :class="{ 'text-error': (profitEstimate ?? 0) < 0 }">
            <MoneyDisplay :amount="profitEstimate" />
          </span>
        </template>
      </v-list-item>
      <v-list-item>
        <template #prepend><v-icon icon="mdi-bank-outline" /></template>
        <v-list-item-title>{{ t('projects.summary.cashPosition') }}</v-list-item-title>
        <template #append>
          <span :class="{ 'text-error': cashPosition < 0 }">
            <MoneyDisplay :amount="cashPosition" />
          </span>
        </template>
      </v-list-item>
    </v-list>
  </v-card>
</template>
