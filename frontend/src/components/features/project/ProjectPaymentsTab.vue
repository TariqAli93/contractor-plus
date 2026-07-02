<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { t } from '@/i18n';
import { paymentsApi } from '@/services/api/payments.api';
import { useApiError } from '@/composables/useApiError';
import { useToast } from '@/composables/useToast';
import { useAccess } from '@/composables/useAccess';
import { useConfirm } from '@/composables/useConfirm';
import { useCurrencyFormat } from '@/composables/useCurrencyFormat';
import { numOrNull } from '@/lib/number';
import { PaymentMethod, RoleName } from '@/types/enums';
import type {
  CreatePaymentInput,
  Payment,
  ProjectPaymentSummary,
  UpdatePaymentInput,
} from '@/types/payment';
import type {
  GridCellCommit,
  GridColumn,
  GridPastePayload,
  GridRow,
  GridRowAction,
} from '@/components/shared/datagrid/types';
import DataGrid from '@/components/shared/datagrid/DataGrid.vue';
import {
  buildPaymentColumns,
  paymentRowClass,
} from '@/components/features/payment/paymentGridColumns';
import SummaryCard from '@/components/shared/SummaryCard.vue';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';
import ErrorState from '@/components/shared/ErrorState.vue';
import RoleGate from '@/components/shared/RoleGate.vue';
import AddPaymentDialog from './AddPaymentDialog.vue';

const props = defineProps<{ projectId: string }>();
const emit = defineEmits<{ (e: 'changed'): void }>();
const { handle } = useApiError();
const toast = useToast();
const { canAccess } = useAccess();
const { confirm } = useConfirm();
const { format: money } = useCurrencyFormat();

// Payments are finance-only — engineers/viewers read but can't post.
const WRITE_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT];
const ADD_PERMS = ['payments.create'];
const canCreate = computed(() => canAccess({ permissions: ADD_PERMS, roles: WRITE_ROLES }));
const canEdit = computed(() => canAccess({ permissions: ['payments.update'], roles: WRITE_ROLES }));
const canDelete = computed(() => canAccess({ permissions: ['payments.delete'], roles: WRITE_ROLES }));

const PAGE_SIZE = 100;
const summary = ref<ProjectPaymentSummary | null>(null);
const payments = ref<Payment[]>([]);
const total = ref(0);
const loading = ref(false);
const error = ref<unknown>(null);

async function refresh() {
  loading.value = true;
  error.value = null;
  try {
    const [sum, list] = await Promise.all([
      paymentsApi.getProjectSummary(props.projectId),
      paymentsApi.listForProject(props.projectId, { pageSize: PAGE_SIZE }),
    ]);
    summary.value = sum;
    payments.value = list.items;
    total.value = list.total;
  } catch (e) {
    error.value = e;
    handle(e);
  } finally {
    loading.value = false;
  }
}
onMounted(refresh);
watch(() => props.projectId, refresh);

const columns = computed<GridColumn[]>(() => buildPaymentColumns({ t, money }));
const gridRows = computed<GridRow[]>(() => payments.value as unknown as GridRow[]);

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function newRowFactory(): Record<string, unknown> {
  return {
    dueDate: todayIso(),
    amount: null,
    method: null,
    reference: '',
    status: 'PENDING',
    paymentDate: null,
  };
}

function paymentPatch(values: Record<string, unknown>): UpdatePaymentInput {
  const patch: UpdatePaymentInput = {};
  if ('dueDate' in values && values.dueDate) patch.dueDate = String(values.dueDate);
  if ('amount' in values) {
    const a = numOrNull(values.amount);
    if (a != null) patch.amount = a;
  }
  if ('method' in values) patch.method = (values.method as PaymentMethod | null) ?? null;
  if ('reference' in values)
    patch.reference = values.reference == null || values.reference === '' ? null : String(values.reference);
  return patch;
}

function buildCreate(values: Record<string, unknown>): CreatePaymentInput | null {
  const amount = numOrNull(values.amount);
  const dueDate = values.dueDate ? String(values.dueDate) : '';
  if (amount == null || !dueDate) return null;
  return {
    projectId: props.projectId,
    amount,
    dueDate,
    method: (values.method as PaymentMethod | null) ?? null,
    reference: values.reference == null || values.reference === '' ? null : String(values.reference),
    notes: null,
  };
}

async function onCellCommit(p: GridCellCommit) {
  try {
    await paymentsApi.update(p.id, paymentPatch({ [p.field]: p.value }));
    await refresh();
    emit('changed');
  } catch (e) {
    handle(e);
    await refresh();
  }
}

async function onNewCommit(values: Record<string, unknown>) {
  const payload = buildCreate(values);
  if (!payload) {
    toast.error(t('projects.payments.gridAddInvalid'));
    return;
  }
  try {
    await paymentsApi.create(payload);
    toast.success(t('projects.payments.paymentCreated'));
    await refresh();
    emit('changed');
  } catch (e) {
    handle(e);
  }
}

async function onPaste(payload: GridPastePayload) {
  try {
    for (const u of payload.updates) await paymentsApi.update(u.id, paymentPatch(u.values));
    let skipped = 0;
    for (const row of payload.creates) {
      const create = buildCreate(row);
      if (create) await paymentsApi.create(create);
      else skipped++;
    }
    toast.success(t('datagrid.pasteApplied'));
    if (skipped > 0) toast.error(t('datagrid.pasteSkipped'));
    await refresh();
    emit('changed');
  } catch (e) {
    handle(e);
    await refresh();
  }
}

async function onDeleteRows(ids: string[]) {
  const ok = await confirm({
    title: t('projects.payments.deleteTitle'),
    message: t('projects.payments.deleteManyMsg').replace('{n}', String(ids.length)),
    confirmText: t('common.delete'),
    destructive: true,
  });
  if (!ok) return;
  try {
    for (const id of ids) await paymentsApi.remove(id);
    toast.success(t('common.deleted'));
    await refresh();
    emit('changed');
  } catch (e) {
    handle(e);
    await refresh();
  }
}

function rowActions(row: GridRow): GridRowAction[] {
  const actions: GridRowAction[] = [];
  if (canDelete.value) {
    actions.push({
      label: t('datagrid.deleteRow'),
      icon: 'mdi-delete',
      danger: true,
      perform: () => void onDeleteRows([String(row.id)]),
    });
  }
  return actions;
}

const addOpen = ref(false);
async function onCreated() {
  await refresh();
  emit('changed');
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-3 gap-3 flex-wrap">
      <h2 class="text-h6">{{ t('projects.payments.title') }}</h2>
      <div class="flex items-center gap-2">
        <RoleGate :permissions="ADD_PERMS" :roles="WRITE_ROLES">
          <v-btn color="primary" prepend-icon="mdi-cash-plus" @click="addOpen = true">
            {{ t('projects.payments.addPayment') }}
          </v-btn>
        </RoleGate>
        <v-btn variant="tonal" prepend-icon="mdi-refresh" :loading="loading" @click="refresh">
          {{ t('common.retry') }}
        </v-btn>
      </div>
    </div>

    <ErrorState v-if="error" :error="error" class="my-4" @retry="refresh" />

    <template v-else-if="summary">
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <SummaryCard :title="t('projects.payments.summary.contractTotal')" icon="mdi-file-sign">
          <MoneyDisplay :amount="summary.contractTotal" />
        </SummaryCard>
        <SummaryCard :title="t('projects.payments.summary.totalPaid')" icon="mdi-cash-plus">
          <MoneyDisplay :amount="summary.totalPaid" />
        </SummaryCard>
        <SummaryCard :title="t('projects.payments.summary.remaining')" icon="mdi-cash-clock">
          <MoneyDisplay :amount="summary.remainingBalance" />
        </SummaryCard>
        <SummaryCard :title="t('projects.payments.summary.collection')" icon="mdi-percent-outline">
          {{ summary.collectionPercentage !== null ? `${summary.collectionPercentage}%` : '—' }}
        </SummaryCard>
      </div>

      <div class="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <span class="text-h6">{{ t('projects.payments.latest') }}</span>
        <span v-if="canCreate || canEdit" class="text-caption text-medium-emphasis">
          {{ t('datagrid.hint') }}
        </span>
      </div>

      <DataGrid
        :rows="gridRows"
        :columns="columns"
        :editable="canEdit"
        :show-new-row="canCreate"
        :new-row-factory="newRowFactory"
        :selectable="canDelete"
        :row-actions="rowActions"
        :row-class="paymentRowClass"
        :enable-csv="true"
        export-name="payments"
        :loading="loading"
        height="440px"
        @cell-commit="onCellCommit"
        @new-commit="onNewCommit"
        @paste="onPaste"
        @delete-rows="onDeleteRows"
      />

      <p v-if="total > payments.length" class="text-caption text-medium-emphasis mt-2">
        {{ t('datagrid.truncated').replace('{shown}', String(payments.length)).replace('{total}', String(total)) }}
      </p>
    </template>

    <v-progress-linear v-else indeterminate />

    <AddPaymentDialog v-model="addOpen" :project-id="projectId" @created="onCreated" />
  </div>
</template>
