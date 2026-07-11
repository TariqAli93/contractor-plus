<script setup lang="ts">
// Payments workspace: a dense grid on one side, the selected payment's property
// sheet on the other. Single click selects (the pane follows), double click
// opens the full record - the Explorer/Access convention. On a window too narrow
// for two panes the single click navigates instead.
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
import DataTable from '@/components/shared/DataTable.vue';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';
import PaymentStatusBadge from '@/components/features/payment/PaymentStatusBadge.vue';
import MarkPaidDialog from '@/components/features/payment/MarkPaidDialog.vue';
import WorkspaceSplit from '@/components/shared/workspace/WorkspaceSplit.vue';
import DetailsPane from '@/components/shared/workspace/DetailsPane.vue';
import PropertyGrid from '@/components/shared/workspace/PropertyGrid.vue';
import type { PropertyRow } from '@/components/shared/workspace/types';

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

function projectName(id: string): string | null {
  return projects.value.find((p) => p.id === id)?.name ?? null;
}

const statusFilter = computed<'all' | PaymentStatus>(() => status.value ?? 'all');
function onStatusChange(v: 'all' | PaymentStatus) {
  setStatusFilter(v === 'all' ? undefined : v);
}

const localDueFrom = ref<string | undefined>(undefined);
const localDueTo = ref<string | undefined>(undefined);
watch([localDueFrom, localDueTo], ([from, to]) => setDueDateRange(from, to));

// Selection is mirrored to ?id= so a refresh reopens the same record.
const selectedId = ref<string | null>(
  typeof route.query.id === 'string' ? route.query.id : null,
);
const selected = computed<Payment | null>(
  () => items.value.find((p) => p.id === selectedId.value) ?? null,
);

// True when the details pane is actually on screen; WorkspaceSplit owns the rule.
const splitActive = ref(true);

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

function select(p: Payment) {
  if (!splitActive.value) {
    openEdit(p);
    return;
  }
  selectedId.value = p.id;
  void router.replace({ query: { ...route.query, id: p.id } });
}

function onRowClick(_e: unknown, row: { item: Payment }) {
  select(row.item);
}
function onRowDblClick(_e: unknown, row: { item: Payment }) {
  openEdit(row.item);
}

/** Mark the selected row so the grid and the pane agree at a glance. */
function rowProps({ item }: { item: Payment }) {
  return item.id === selectedId.value ? { class: 'cp-row-selected' } : {};
}

const rows = computed<PropertyRow[]>(() => {
  const p = selected.value;
  if (!p) return [];
  return [
    { key: 'project', label: t('payments.fields.project'), value: projectName(p.projectId) },
    { key: 'dueDate', label: t('payments.fields.dueDate') },
    { key: 'status', label: t('payments.fields.status') },
    { key: 'amount', label: t('payments.fields.amount'), tabular: true },
    { key: 'paymentDate', label: t('payments.fields.paymentDate') },
    { key: 'method', label: t('payments.fields.method') },
    { key: 'reference', label: t('payments.fields.reference'), value: p.reference },
    { key: 'notes', label: t('payments.fields.notes'), value: p.notes },
  ];
});

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
    if (selectedId.value === p.id) selectedId.value = null;
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
  <div class="cp-fill">
    <PageHeader :title="t('nav.payments')" :count="total || null" icon="mdi-cash-plus" :hint="t('help.payments')">
      <RoleGate :permissions="WRITE_PERMS" :roles="WRITE_ROLES">
        <v-btn color="primary" size="small" variant="flat" prepend-icon="mdi-plus" @click="newPayment">
          {{ t('payments.new') }}
        </v-btn>
      </RoleGate>
    </PageHeader>

    <WorkspaceSplit storage-key="payments" @update:show-details="splitActive = $event">
      <div class="cp-pane">
        <div class="cp-pane__toolbar">
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
        </div>

        <ErrorState v-if="error" :error="error" class="ma-3" @retry="fetch" />

        <div v-else class="cp-pane__body">
          <DataTable
            :items="items"
            :items-length="total"
            :headers="columns"
            :loading="loading"
            :page="page"
            :items-per-page="pageSize"
            :items-per-page-options="[25, 50, 100, 200]"
            item-value="id"
            hover
            density="compact"
            :row-props="rowProps"
            @update:options="onTableUpdate"
            @click:row="onRowClick"
            @dblclick:row="onRowDblClick"
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
              <span v-else class="text-medium-emphasis">-</span>
            </template>
            <template #[`item.reference`]="{ item }">
              <span v-if="item.reference">{{ item.reference }}</span>
              <span v-else class="text-medium-emphasis">-</span>
            </template>
            <template #[`item.actions`]="{ item }">
              <div class="cp-row-actions" @click.stop>
                <RoleGate :permissions="WRITE_PERMS" :roles="WRITE_ROLES">
                  <v-btn
                    v-if="canMarkPaid(item)"
                    icon="mdi-check"
                    size="x-small"
                    variant="text"
                    color="success"
                    :title="t('payments.markPaid.title')"
                    @click="openMarkPaid(item)"
                  />
                  <v-btn
                    v-if="canCancel(item)"
                    icon="mdi-close"
                    size="x-small"
                    variant="text"
                    color="warning"
                    :title="t('payments.cancel.title')"
                    @click="handleCancel(item)"
                  />
                  <v-btn
                    v-if="canEditDelete(item)"
                    icon="mdi-pencil"
                    size="x-small"
                    variant="text"
                    @click="openEdit(item)"
                  />
                  <v-btn
                    v-if="canEditDelete(item)"
                    icon="mdi-delete-outline"
                    size="x-small"
                    variant="text"
                    color="error"
                    @click="handleDelete(item)"
                  />
                </RoleGate>
              </div>
            </template>
          </DataTable>
        </div>
      </div>

      <template #details>
        <DetailsPane
          :title="selected?.reference ?? t('details.title')"
          icon="mdi-cash"
          :selected="Boolean(selected)"
        >
          <PropertyGrid :rows="rows">
            <template #dueDate>
              <DateDisplay :value="selected?.dueDate" />
            </template>
            <template #status>
              <PaymentStatusBadge v-if="selected" :status="selected.status" />
            </template>
            <template #amount>
              <MoneyDisplay v-if="selected" :amount="selected.amount" />
            </template>
            <template #paymentDate>
              <DateDisplay :value="selected?.paymentDate" />
            </template>
            <template #method>
              <span v-if="selected?.method">{{ t(`payments.method.${selected.method}`) }}</span>
              <span v-else>-</span>
            </template>
          </PropertyGrid>

          <template #actions>
            <RoleGate :permissions="WRITE_PERMS" :roles="WRITE_ROLES">
              <v-btn
                v-if="selected && canMarkPaid(selected)"
                size="x-small"
                variant="flat"
                color="success"
                prepend-icon="mdi-check"
                @click="selected && openMarkPaid(selected)"
              >
                {{ t('payments.markPaid.title') }}
              </v-btn>
              <v-btn
                v-if="selected && canCancel(selected)"
                size="x-small"
                variant="text"
                color="warning"
                prepend-icon="mdi-close"
                @click="selected && handleCancel(selected)"
              >
                {{ t('payments.cancel.title') }}
              </v-btn>
              <v-btn
                v-if="selected && canEditDelete(selected)"
                size="x-small"
                variant="flat"
                color="primary"
                prepend-icon="mdi-pencil"
                @click="selected && openEdit(selected)"
              >
                {{ t('common.edit') }}
              </v-btn>
              <v-btn
                v-if="selected && canEditDelete(selected)"
                size="x-small"
                variant="text"
                color="error"
                prepend-icon="mdi-delete-outline"
                @click="selected && handleDelete(selected)"
              >
                {{ t('common.delete') }}
              </v-btn>
            </RoleGate>
          </template>
        </DetailsPane>
      </template>
    </WorkspaceSplit>

    <MarkPaidDialog
      v-model="markPaidOpen"
      :submitting="markPaidSubmitting"
      @confirm="submitMarkPaid"
    />
  </div>
</template>

<style scoped>
.cp-row-actions {
  display: flex;
  justify-content: flex-end;
  gap: 2px;
}
</style>
