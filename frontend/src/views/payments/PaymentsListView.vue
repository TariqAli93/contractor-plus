<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { t } from '@/i18n';
import { usePayments } from '@/composables/usePayments';
import { useConfirm } from '@/composables/useConfirm';
import { useToast } from '@/composables/useToast';
import { useApiError } from '@/composables/useApiError';
import { paymentsApi } from '@/services/api/payments.api';
import { projectsApi } from '@/services/api/projects.api';
import { buildPaymentColumns } from '@/components/features/payment/paymentColumns';
import { PaymentStatus, RoleName } from '@/types/enums';
import type { MarkPaidBody, Payment } from '@/types/payment';
import type { ProjectWithContract } from '@/types/project';
import SearchBar from '@/components/shared/SearchBar.vue';
import ErrorState from '@/components/shared/ErrorState.vue';
import RoleGate from '@/components/shared/RoleGate.vue';
import PageHeader from '@/components/shared/PageHeader.vue';
import DateDisplay from '@/components/shared/DateDisplay.vue';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';
import PaymentStatusBadge from '@/components/features/payment/PaymentStatusBadge.vue';
import MarkPaidDialog from '@/components/features/payment/MarkPaidDialog.vue';

const router = useRouter();
const route = useRoute();
const toast = useToast();
const { confirm } = useConfirm();
const { handle } = useApiError();

const {
  items,
  total,
  loading,
  error,
  page,
  pageSize,
  searchInput,
  projectId,
  status,
  late,
  sortBy,
  sortDir,
  fetch,
  setProjectFilter,
  setStatusFilter,
  setLateFilter,
  setDueDateRange,
} = usePayments();

const WRITE_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT];
const WRITE_PERMS = ['payments.create', 'payments.update', 'payments.delete', 'payments.mark_paid', 'payments.cancel'];

const columns = computed(() => buildPaymentColumns(t));

// Project picker
const projects = ref<ProjectWithContract[]>([]);
async function loadProjects() {
  try {
    const p = await projectsApi.list({
      page: 1,
      pageSize: 100,
      sortBy: 'name',
      sortDir: 'asc',
    });
    projects.value = p.items;
  } catch {
    /* picker failure non-fatal */
  }
}

const projectOptions = computed(() => [
  { value: undefined as string | undefined, title: t('payments.filter.allProjects') },
  ...projects.value.map((p) => ({ value: p.id, title: p.name })),
]);

const statusFilter = computed<'all' | PaymentStatus>(() => status.value ?? 'all');
function onStatusChange(v: 'all' | PaymentStatus) {
  setStatusFilter(v === 'all' ? undefined : v);
}

const localDueFrom = ref<string | undefined>(undefined);
const localDueTo = ref<string | undefined>(undefined);
watch([localDueFrom, localDueTo], ([from, to]) => setDueDateRange(from, to));

onMounted(async () => {
  const qp = route.query.projectId;
  if (typeof qp === 'string' && qp.length > 0) setProjectFilter(qp);
  await Promise.all([loadProjects(), fetch()]);
});

function onTableUpdate(opts: {
  page: number;
  itemsPerPage: number;
  sortBy: Array<{ key: string; order: 'asc' | 'desc' }>;
}) {
  page.value = opts.page;
  pageSize.value = opts.itemsPerPage;
  const first = opts.sortBy[0];
  if (first && (first.key === 'dueDate' || first.key === 'amount' || first.key === 'paymentDate')) {
    sortBy.value = first.key;
    sortDir.value = first.order;
  } else if (opts.sortBy.length === 0) {
    sortBy.value = 'dueDate';
    sortDir.value = 'asc';
  }
}

function openEdit(p: Payment) {
  void router.push(`/payments/${p.id}`);
}

function newPayment() {
  const qs = projectId.value ? `?projectId=${projectId.value}` : '';
  void router.push(`/payments/new${qs}`);
}

async function handleDelete(p: Payment) {
  const ok = await confirm({
    title: t('payments.deleteConfirmTitle'),
    message: t('payments.deleteConfirmMessage'),
    confirmText: t('common.delete'),
    destructive: true,
  });
  if (!ok) return;
  try {
    await paymentsApi.remove(p.id);
    toast.success(t('common.deleted'));
    await fetch();
  } catch (e) {
    handle(e);
  }
}

// ----- Mark paid / Cancel -----

const markPaidOpen = ref(false);
const markPaidTarget = ref<Payment | null>(null);
const markPaidSubmitting = ref(false);

function openMarkPaid(p: Payment) {
  markPaidTarget.value = p;
  markPaidOpen.value = true;
}

async function submitMarkPaid(body: MarkPaidBody) {
  const target = markPaidTarget.value;
  if (!target) return;
  markPaidSubmitting.value = true;
  try {
    await paymentsApi.markPaid(target.id, body);
    toast.success(t('payments.toasts.marked'));
    markPaidOpen.value = false;
    await fetch();
  } catch (e) {
    handle(e);
  } finally {
    markPaidSubmitting.value = false;
  }
}

async function handleCancel(p: Payment) {
  const ok = await confirm({
    title: t('payments.cancel.title'),
    message: t('payments.cancel.message'),
    confirmText: t('payments.cancel.confirm'),
    destructive: true,
  });
  if (!ok) return;
  try {
    await paymentsApi.cancel(p.id);
    toast.success(t('payments.toasts.cancelled'));
    await fetch();
  } catch (e) {
    handle(e);
  }
}

function canMarkPaid(p: Payment) {
  return p.status === PaymentStatus.PENDING || p.status === PaymentStatus.LATE;
}

function canCancel(p: Payment) {
  return p.status === PaymentStatus.PENDING || p.status === PaymentStatus.LATE;
}

function canEditDelete(p: Payment) {
  return p.status === PaymentStatus.PENDING || p.status === PaymentStatus.LATE;
}
</script>

<template>
  <div>
    <PageHeader :title="t('nav.payments')" :count="total || null" icon="mdi-cash-plus">
      <RoleGate :permissions="WRITE_PERMS" :roles="WRITE_ROLES">
        <v-btn color="primary" prepend-icon="mdi-plus" @click="newPayment">
          {{ t('payments.new') }}
        </v-btn>
      </RoleGate>
    </PageHeader>

    <v-card>
      <v-card-text class="space-y-3">
        <div class="flex flex-wrap items-center gap-3">
          <div class="flex-1 min-w-[240px]">
            <SearchBar v-model="searchInput" :placeholder="t('payments.searchPlaceholder')" />
          </div>
          <v-select
            :model-value="projectId"
            :items="projectOptions"
            :label="t('payments.filter.project')"
            density="compact"
            hide-details
            style="min-width: 220px"
            clearable
            @update:model-value="setProjectFilter"
          />
          <v-text-field
            v-model="localDueFrom"
            :label="t('payments.filter.dueFrom')"
            type="date"
            density="compact"
            hide-details
            style="max-width: 170px"
          />
          <v-text-field
            v-model="localDueTo"
            :label="t('payments.filter.dueTo')"
            type="date"
            density="compact"
            hide-details
            style="max-width: 170px"
          />
          <v-switch
            :model-value="late"
            :label="t('payments.filter.lateOnly')"
            color="error"
            hide-details
            inset
            density="compact"
            @update:model-value="(v) => setLateFilter(Boolean(v))"
          />
        </div>
        <v-chip-group
          :model-value="statusFilter"
          mandatory
          selected-class="bg-primary text-white"
          @update:model-value="onStatusChange"
        >
          <v-chip value="all" size="small">{{ t('payments.filter.allStatuses') }}</v-chip>
          <v-chip :value="PaymentStatus.PENDING" size="small">
            {{ t('payments.status.PENDING') }}
          </v-chip>
          <v-chip :value="PaymentStatus.PAID" size="small">
            {{ t('payments.status.PAID') }}
          </v-chip>
          <v-chip :value="PaymentStatus.LATE" size="small">
            {{ t('payments.status.LATE') }}
          </v-chip>
          <v-chip :value="PaymentStatus.CANCELLED" size="small">
            {{ t('payments.status.CANCELLED') }}
          </v-chip>
        </v-chip-group>
      </v-card-text>

      <v-divider />

      <ErrorState v-if="error" :error="error" class="my-4" @retry="fetch" />

      <v-data-table-server
        v-else
        :items="items"
        :items-length="total"
        :headers="columns"
        :loading="loading"
        :page="page"
        :items-per-page="pageSize"
        :items-per-page-options="[10, 20, 50, 100]"
        item-value="id"
        hover
        @update:options="onTableUpdate"
      >
        <template #[`item.dueDate`]="{ item }">
          <DateDisplay :value="item.dueDate" />
        </template>
        <template #[`item.status`]="{ item }">
          <PaymentStatusBadge :status="item.status" />
        </template>
        <template #[`item.amount`]="{ item }">
          <span class="font-medium"><MoneyDisplay :amount="item.amount" /></span>
        </template>
        <template #[`item.paymentDate`]="{ item }">
          <DateDisplay :value="item.paymentDate" />
        </template>
        <template #[`item.method`]="{ item }">
          <span v-if="item.method">{{ t(`payments.method.${item.method}`) }}</span>
          <span v-else class="text-medium-emphasis">—</span>
        </template>
        <template #[`item.reference`]="{ item }">
          <span v-if="item.reference">{{ item.reference }}</span>
          <span v-else class="text-medium-emphasis">—</span>
        </template>
        <template #[`item.actions`]="{ item }">
          <div class="flex justify-end gap-1" @click.stop>
            <RoleGate :permissions="WRITE_PERMS" :roles="WRITE_ROLES">
              <v-btn
                v-if="canMarkPaid(item)"
                icon="mdi-check"
                size="small"
                variant="text"
                color="success"
                :title="t('payments.markPaid.title')"
                @click="openMarkPaid(item)"
              />
              <v-btn
                v-if="canCancel(item)"
                icon="mdi-close"
                size="small"
                variant="text"
                color="warning"
                :title="t('payments.cancel.title')"
                @click="handleCancel(item)"
              />
              <v-btn
                v-if="canEditDelete(item)"
                icon="mdi-pencil"
                size="small"
                variant="text"
                @click="openEdit(item)"
              />
              <v-btn
                v-if="canEditDelete(item)"
                icon="mdi-delete-outline"
                size="small"
                variant="text"
                color="error"
                @click="handleDelete(item)"
              />
            </RoleGate>
          </div>
        </template>
      </v-data-table-server>
    </v-card>

    <MarkPaidDialog
      v-model="markPaidOpen"
      :submitting="markPaidSubmitting"
      @confirm="submitMarkPaid"
    />
  </div>
</template>
