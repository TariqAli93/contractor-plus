<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { paymentsApi } from '@/services/api/payments.api';
import { useApiError } from '@/composables/useApiError';
import { PaymentStatus, RoleName } from '@/types/enums';
import type { ProjectPaymentSummary } from '@/types/payment';
import SummaryCard from '@/components/shared/SummaryCard.vue';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';
import EmptyState from '@/components/shared/EmptyState.vue';
import ErrorState from '@/components/shared/ErrorState.vue';
import DateDisplay from '@/components/shared/DateDisplay.vue';
import RoleGate from '@/components/shared/RoleGate.vue';
import AddPaymentDialog from './AddPaymentDialog.vue';

const props = defineProps<{ projectId: string }>();
const emit = defineEmits<{ (e: 'changed'): void }>();
const { t } = useI18n();
const { handle } = useApiError();

// Payments are finance-only — engineers and viewers can read the panel but
// not post a new receipt. Matches the backend's PaymentsRoutes WRITE_ROLES.
const ADD_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT];

const summary = ref<ProjectPaymentSummary | null>(null);
const loading = ref(false);
const error = ref<unknown>(null);

async function fetch() {
  loading.value = true;
  error.value = null;
  try {
    summary.value = await paymentsApi.getProjectSummary(props.projectId);
  } catch (e) {
    error.value = e;
    handle(e);
  } finally {
    loading.value = false;
  }
}

function statusColor(status: PaymentStatus): string | undefined {
  switch (status) {
    case PaymentStatus.PAID:
      return 'success';
    case PaymentStatus.PENDING:
      return 'info';
    case PaymentStatus.LATE:
      return 'error';
    case PaymentStatus.CANCELLED:
      return undefined;
  }
}

onMounted(fetch);
watch(() => props.projectId, fetch);

const addOpen = ref(false);

async function onCreated() {
  await fetch();
  emit('changed');
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-3 gap-3 flex-wrap">
      <h2 class="text-h6">{{ t('projects.payments.title') }}</h2>
      <div class="flex items-center gap-2">
        <RoleGate :roles="ADD_ROLES">
          <v-btn
            color="primary"
            prepend-icon="mdi-cash-plus"
            @click="addOpen = true"
          >
            {{ t('projects.payments.addPayment') }}
          </v-btn>
        </RoleGate>
        <v-btn
          variant="tonal"
          prepend-icon="mdi-refresh"
          :loading="loading"
          @click="fetch"
        >
          {{ t('common.retry') }}
        </v-btn>
      </div>
    </div>

    <ErrorState v-if="error" :error="error" class="my-4" @retry="fetch" />

    <template v-else-if="summary">
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <SummaryCard
          :title="t('projects.payments.summary.contractTotal')"
          icon="mdi-file-sign"
        >
          <MoneyDisplay :amount="summary.contractTotal" />
        </SummaryCard>
        <SummaryCard
          :title="t('projects.payments.summary.totalPaid')"
          icon="mdi-cash-plus"
        >
          <MoneyDisplay :amount="summary.totalPaid" />
        </SummaryCard>
        <SummaryCard
          :title="t('projects.payments.summary.remaining')"
          icon="mdi-cash-clock"
        >
          <MoneyDisplay :amount="summary.remainingBalance" />
        </SummaryCard>
        <SummaryCard
          :title="t('projects.payments.summary.collection')"
          icon="mdi-percent-outline"
        >
          {{ summary.collectionPercentage !== null ? `${summary.collectionPercentage}%` : '—' }}
        </SummaryCard>
        <SummaryCard
          :title="t('projects.payments.summary.pending')"
          icon="mdi-clock-outline"
        >
          {{ summary.pendingPayments }}
        </SummaryCard>
        <SummaryCard
          :title="t('projects.payments.summary.late')"
          icon="mdi-clock-alert-outline"
        >
          {{ summary.latePayments }}
        </SummaryCard>
        <SummaryCard
          :title="t('projects.payments.summary.paid')"
          icon="mdi-check-circle-outline"
        >
          {{ summary.paidPayments }}
        </SummaryCard>
        <SummaryCard
          :title="t('projects.payments.summary.cancelled')"
          icon="mdi-cancel"
        >
          {{ summary.cancelledPayments }}
        </SummaryCard>
      </div>

      <v-card variant="outlined">
        <v-card-title class="text-h6">{{ t('projects.payments.latest') }}</v-card-title>
        <v-divider />
        <v-table density="comfortable" hover>
          <thead>
            <tr>
              <th class="text-start" style="width: 130px">{{ t('projects.payments.fields.dueDate') }}</th>
              <th class="text-end" style="width: 140px">{{ t('projects.payments.fields.amount') }}</th>
              <th class="text-start" style="width: 130px">{{ t('projects.payments.fields.status') }}</th>
              <th class="text-start" style="width: 130px">{{ t('projects.payments.fields.paymentDate') }}</th>
              <th class="text-start" style="width: 140px">{{ t('projects.payments.fields.method') }}</th>
              <th class="text-start">{{ t('projects.payments.fields.reference') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in summary.latestPayments" :key="p.id">
              <td><DateDisplay :value="p.dueDate" /></td>
              <td class="text-end"><MoneyDisplay :amount="p.amount" /></td>
              <td>
                <v-chip size="x-small" variant="tonal" :color="statusColor(p.status)">
                  {{ p.status }}
                </v-chip>
              </td>
              <td><DateDisplay :value="p.paymentDate" /></td>
              <td>{{ p.method ?? '—' }}</td>
              <td>{{ p.reference ?? '—' }}</td>
            </tr>
          </tbody>
        </v-table>
        <EmptyState
          v-if="summary.latestPayments.length === 0"
          :title="t('projects.payments.empty')"
          icon="mdi-cash-plus"
        />
      </v-card>
    </template>

    <v-progress-linear v-else indeterminate />

    <AddPaymentDialog
      v-model="addOpen"
      :project-id="projectId"
      @created="onCreated"
    />
  </div>
</template>
