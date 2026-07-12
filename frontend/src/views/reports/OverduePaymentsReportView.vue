<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { t } from '@/i18n';
import { reportsApi } from '@/services/api/reports.api';
import { ApiError } from '@/types/api';
import type { OverduePaymentsByProject } from '@/types/report';
import ErrorState from '@/components/shared/ErrorState.vue';
import EmptyState from '@/components/shared/EmptyState.vue';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';
import DateDisplay from '@/components/shared/DateDisplay.vue';
import PageHeader from '@/components/shared/PageHeader.vue';
import DataTable from '@/components/shared/DataTable.vue';
import AiNarrativeCard from '@/components/features/reports/AiNarrativeCard.vue';

const groups = ref<OverduePaymentsByProject[]>([]);
const loading = ref(false);
const error = ref<ApiError | null>(null);

async function fetch() {
  loading.value = true;
  error.value = null;
  try {
    groups.value = await reportsApi.overduePayments();
  } catch (e) {
    error.value = e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', String(e));
  } finally {
    loading.value = false;
  }
}

onMounted(fetch);

const rows = computed(() => groups.value.flatMap((group) => group.payments.map((payment) => ({
  ...payment,
  projectId: group.projectId,
  projectName: group.projectName,
  customerName: group.customerName,
  contractNumber: group.contractNumber,
}))));

const headers = computed(() => [
  { key: 'projectName', title: t('projects.fields.name'), sortable: true },
  { key: 'customerName', title: t('customers.fields.name'), sortable: true },
  { key: 'dueDate', title: t('payments.fields.dueDate'), sortable: true, width: 130 },
  { key: 'daysOverdue', title: t('reports.overdue.daysLate'), sortable: true, width: 110, align: 'end' as const },
  { key: 'method', title: t('payments.fields.method'), sortable: true, width: 130 },
  { key: 'reference', title: t('payments.fields.reference'), sortable: true },
  { key: 'amount', title: t('payments.fields.amount'), sortable: true, align: 'end' as const },
]);
</script>

<template>
  <div class="cp-fill">
    <PageHeader :title="t('reports.overdue.title')" back="/reports">
      <v-btn variant="text" size="small" prepend-icon="mdi-refresh" :loading="loading" @click="fetch">
        {{ t('common.retry') }}
      </v-btn>
    </PageHeader>

    <ErrorState v-if="error" :error="error" class="ma-3" @retry="fetch" />

    <section v-else class="cp-pane">
      <div class="cp-pane__toolbar">
        <span class="text-caption text-medium-emphasis">{{ t('reports.overdue.title') }}</span>
        <span class="text-caption text-medium-emphasis">{{ rows.length }}</span>
      </div>
      <div class="cp-pane__body">
        <DataTable
          :items="rows"
          :items-length="rows.length"
          :headers="headers"
          :loading="loading"
          :items-per-page="-1"
          :server="false"
          item-value="id"
          hide-default-footer
        >
          <template #[`item.projectName`]="{ item }">
            <RouterLink :to="`/projects/${item.projectId}`" class="cp-overdue__project">
              {{ item.projectName }}
            </RouterLink>
            <small v-if="item.contractNumber">{{ item.contractNumber }}</small>
          </template>
          <template #[`item.customerName`]="{ item }">
            {{ item.customerName ?? '-' }}
          </template>
          <template #[`item.dueDate`]="{ item }">
            <DateDisplay :value="item.dueDate" />
          </template>
          <template #[`item.daysOverdue`]="{ item }">
            <span class="text-error font-weight-medium">{{ item.daysOverdue }}d</span>
          </template>
          <template #[`item.method`]="{ item }">
            {{ item.method ?? '-' }}
          </template>
          <template #[`item.reference`]="{ item }">
            {{ item.reference ?? '-' }}
          </template>
          <template #[`item.amount`]="{ item }">
            <MoneyDisplay :amount="item.amount" />
          </template>
          <template #no-data>
            <EmptyState :title="t('reports.overdue.empty')" icon="mdi-check-circle-outline" />
          </template>
        </DataTable>
      </div>
    </section>

    <AiNarrativeCard v-if="!error" report-type="overdue-payments" />
  </div>
</template>

<style scoped>
.cp-overdue__project {
  display: block;
  color: var(--cp-primary);
  font-weight: 600;
  text-decoration: none;
}
.cp-overdue__project:hover { color: var(--cp-primary-hover); text-decoration: underline; }
.cp-overdue__project + small { color: var(--cp-text-muted); font-size: 0.68rem; }
</style>
