<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { reportsApi } from '@/services/api/reports.api';
import { ApiError } from '@/types/api';
import type { OverduePaymentsByProject } from '@/types/report';
import ErrorState from '@/components/shared/ErrorState.vue';
import EmptyState from '@/components/shared/EmptyState.vue';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';
import DateDisplay from '@/components/shared/DateDisplay.vue';

const { t } = useI18n();

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
</script>

<template>
  <div>
    <div class="flex items-center gap-2 mb-4">
      <v-btn icon="mdi-arrow-right" variant="text" to="/reports" />
      <h1 class="text-h5">{{ t('reports.overdue.title') }}</h1>
      <v-spacer />
      <v-btn variant="text" prepend-icon="mdi-refresh" :loading="loading" @click="fetch">
        {{ t('common.retry') }}
      </v-btn>
    </div>

    <ErrorState v-if="error" :error="error" @retry="fetch" />

    <div v-else-if="loading && groups.length === 0" class="space-y-3">
      <v-skeleton-loader type="article" />
      <v-skeleton-loader type="article" />
    </div>

    <EmptyState
      v-else-if="groups.length === 0"
      :title="t('reports.overdue.empty')"
      icon="mdi-check-circle-outline"
    />

    <div v-else class="space-y-3">
      <v-card v-for="g in groups" :key="g.projectId">
        <v-card-text>
          <div class="flex items-start justify-between flex-wrap gap-3 mb-3">
            <div>
              <RouterLink
                :to="`/projects/${g.projectId}`"
                class="text-subtitle-1 font-medium text-primary"
              >
                {{ g.projectName }}
              </RouterLink>
              <div class="text-caption text-medium-emphasis">
                <span v-if="g.contractNumber">{{ g.contractNumber }}</span>
                <span v-if="g.customerName"> · {{ g.customerName }}</span>
              </div>
            </div>
            <div class="text-end">
              <div class="text-h6 text-error font-medium">
                <MoneyDisplay :amount="g.totalOverdueAmount" />
              </div>
              <div class="text-caption text-medium-emphasis">
                {{ t('reports.overdue.invoiceCount', { n: g.overduePaymentsCount }) }}
                · {{ t('reports.overdue.oldest') }} <DateDisplay :value="g.oldestDueDate" />
              </div>
            </div>
          </div>

          <v-divider class="mb-3" />

          <v-table density="compact">
            <thead>
              <tr>
                <th>{{ t('payments.fields.dueDate') }}</th>
                <th>{{ t('reports.overdue.daysLate') }}</th>
                <th>{{ t('payments.fields.method') }}</th>
                <th>{{ t('payments.fields.reference') }}</th>
                <th class="text-end">{{ t('payments.fields.amount') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in g.payments" :key="row.id">
                <td><DateDisplay :value="row.dueDate" /></td>
                <td class="text-error">{{ row.daysOverdue }}d</td>
                <td>{{ row.method ?? '—' }}</td>
                <td>{{ row.reference ?? '—' }}</td>
                <td class="text-end"><MoneyDisplay :amount="row.amount" /></td>
              </tr>
            </tbody>
          </v-table>
        </v-card-text>
      </v-card>
    </div>
  </div>
</template>
