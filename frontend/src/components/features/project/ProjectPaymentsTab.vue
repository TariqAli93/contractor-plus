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
import { PaymentMethod, PaymentStatus, RoleName } from '@/types/enums';
import type {
  CreatePaymentInput,
  Payment,
  ProjectPaymentSummary,
  UpdatePaymentInput,
} from '@/types/payment';
import DataTable from '@/components/shared/DataTable.vue';
import InlineTextField from '@/components/shared/table/InlineTextField.vue';
import InlineSelect from '@/components/shared/table/InlineSelect.vue';
import InlineTableActions from '@/components/shared/table/InlineTableActions.vue';
import { useInlineTableEditor } from '@/components/shared/table/useInlineTableEditor';
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

// Payments are finance-only - engineers/viewers read but can't post.
const WRITE_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT];
const ADD_PERMS = ['payments.create'];
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

const methodOptions = computed(() => [
  { value: PaymentMethod.CASH, title: t('payments.method.CASH') },
  { value: PaymentMethod.BANK_TRANSFER, title: t('payments.method.BANK_TRANSFER') },
  { value: PaymentMethod.CHECK, title: t('payments.method.CHECK') },
  { value: PaymentMethod.OTHER, title: t('payments.method.OTHER') },
]);

const headers = computed(() => [
  { title: t('payments.fields.dueDate'), key: 'dueDate', width: 150 },
  { title: t('payments.fields.amount'), key: 'amount', align: 'end', width: 140 },
  { title: t('payments.fields.status'), key: 'status', width: 120, sortable: false },
  { title: t('payments.fields.paymentDate'), key: 'paymentDate', width: 140 },
  { title: t('payments.fields.method'), key: 'method', width: 150 },
  { title: t('payments.fields.reference'), key: 'reference', minWidth: 150 },
  { title: '', key: 'actions', align: 'end', sortable: false, width: 92 },
]);

function statusColor(status: unknown): string | undefined {
  if (status === PaymentStatus.PAID) return 'success';
  if (status === PaymentStatus.LATE) return 'error';
  if (status === PaymentStatus.CANCELLED) return undefined;
  return 'default';
}

const editor = useInlineTableEditor<Payment>({
  newDraft: () => ({ dueDate: todayIso(), amount: null, method: null, reference: '' }),
  toDraft: (row) => ({
    dueDate: String(row.dueDate).slice(0, 10),
    amount: row.amount,
    method: row.method,
    reference: row.reference ?? '',
  }),
});

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function rowProps({ item }: { item: Payment }) {
  return editor.isEditing(item) ? { class: 'cp-inline-editing' } : {};
}

function validate(draft: Record<string, unknown>): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!draft.dueDate) errs.dueDate = t('inline.required');
  if (numOrNull(draft.amount) == null) errs.amount = t('inline.required');
  return errs;
}

function toPatch(draft: Record<string, unknown>): UpdatePaymentInput {
  const patch: UpdatePaymentInput = {};
  if (draft.dueDate) patch.dueDate = String(draft.dueDate);
  const a = numOrNull(draft.amount);
  if (a != null) patch.amount = a;
  patch.method = (draft.method as PaymentMethod | null) ?? null;
  patch.reference = draft.reference == null || draft.reference === '' ? null : String(draft.reference);
  return patch;
}
function toCreate(draft: Record<string, unknown>): CreatePaymentInput {
  return {
    projectId: props.projectId,
    amount: numOrNull(draft.amount) ?? 0,
    dueDate: String(draft.dueDate),
    method: (draft.method as PaymentMethod | null) ?? null,
    reference: draft.reference == null || draft.reference === '' ? null : String(draft.reference),
    notes: null,
  };
}

async function saveCreate() {
  const draft = editor.creatingDraft.value;
  if (!draft) return;
  const errs = validate(draft);
  if (Object.keys(errs).length) return editor.setErrors(errs);
  const ok = await editor.runSave(async () => {
    try {
      await paymentsApi.create(toCreate(draft));
      toast.success(t('projects.payments.paymentCreated'));
      await refresh();
      emit('changed');
    } catch (e) {
      handle(e);
      throw e;
    }
  });
  if (ok) editor.cancelCreate();
}

async function saveEdit() {
  const draft = editor.editingDraft.value;
  const id = editor.editingId.value;
  if (!draft || id == null) return;
  const errs = validate(draft);
  if (Object.keys(errs).length) return editor.setErrors(errs);
  const ok = await editor.runSave(async () => {
    try {
      await paymentsApi.update(String(id), toPatch(draft));
      await refresh();
      emit('changed');
    } catch (e) {
      handle(e);
      throw e;
    }
  });
  if (ok) editor.cancelEdit();
}

async function remove(row: Payment) {
  const ok = await confirm({
    title: t('projects.payments.deleteTitle'),
    message: t('projects.payments.deleteMsg', { amount: money(Number(row.amount)) }),
    confirmText: t('common.delete'),
    destructive: true,
  });
  if (!ok) return;
  try {
    await paymentsApi.remove(row.id);
    toast.success(t('common.deleted'));
    await refresh();
    emit('changed');
  } catch (e) {
    handle(e);
  }
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
          {{ summary.collectionPercentage !== null ? `${summary.collectionPercentage}%` : '-' }}
        </SummaryCard>
      </div>

      <div class="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <span class="text-h6">{{ t('projects.payments.latest') }}</span>
        <RoleGate :permissions="ADD_PERMS" :roles="WRITE_ROLES">
          <v-btn
            size="small"
            variant="tonal"
            prepend-icon="mdi-plus"
            :disabled="editor.busy.value"
            @click="editor.startCreate()"
          >
            {{ t('projects.payments.quickAdd') }}
          </v-btn>
        </RoleGate>
      </div>

      <DataTable
        :server="false"
        :items="payments"
        :items-length="payments.length"
        :headers="headers"
        :loading="loading"
        item-value="id"
        :items-per-page="25"
        :items-per-page-options="[25, 50, 100]"
        :row-props="rowProps"
        :aria-label="t('projects.payments.title')"
      >
        <template #body.prepend>
          <tr v-if="editor.isCreating.value" class="cp-inline-add">
            <td>
              <InlineTextField
                field="dueDate"
                kind="date"
                :model-value="editor.createValue('dueDate')"
                :error="editor.errorFor('dueDate')"
                autofocus
                @update:model-value="editor.setCreateValue('dueDate', $event)"
              />
            </td>
            <td>
              <InlineTextField
                field="amount"
                kind="money"
                :model-value="editor.createValue('amount')"
                :step="0.01"
                :min="0"
                :error="editor.errorFor('amount')"
                @update:model-value="editor.setCreateValue('amount', $event)"
              />
            </td>
            <td>
              <v-chip size="x-small" color="default" variant="tonal">
                {{ t('payments.status.PENDING') }}
              </v-chip>
            </td>
            <td>-</td>
            <td>
              <InlineSelect
                field="method"
                :model-value="editor.createValue('method')"
                :items="methodOptions"
                :placeholder="t('payments.method.unset')"
                @update:model-value="editor.setCreateValue('method', $event)"
              />
            </td>
            <td>
              <InlineTextField
                field="reference"
                :model-value="editor.createValue('reference')"
                :placeholder="t('payments.fields.reference')"
                @update:model-value="editor.setCreateValue('reference', $event)"
              />
            </td>
            <td>
              <InlineTableActions editing :saving="editor.saving.value" @save="saveCreate" @cancel="editor.cancelCreate()" />
            </td>
          </tr>
        </template>

        <template #[`item.dueDate`]="{ item }">
          <InlineTextField
            v-if="editor.isEditing(item)"
            field="dueDate"
            kind="date"
            :model-value="editor.editValue('dueDate')"
            :error="editor.errorFor('dueDate')"
            @update:model-value="editor.setEditValue('dueDate', $event)"
          />
          <span v-else>{{ String(item.dueDate).slice(0, 10) }}</span>
        </template>

        <template #[`item.amount`]="{ item }">
          <InlineTextField
            v-if="editor.isEditing(item)"
            field="amount"
            kind="money"
            :model-value="editor.editValue('amount')"
            :step="0.01"
            :min="0"
            :error="editor.errorFor('amount')"
            @update:model-value="editor.setEditValue('amount', $event)"
          />
          <span v-else class="cp-num">{{ money(Number(item.amount)) }}</span>
        </template>

        <template #[`item.status`]="{ item }">
          <v-chip size="x-small" :color="statusColor(item.status)" variant="tonal">
            {{ t('payments.status.' + String(item.status)) }}
          </v-chip>
        </template>

        <template #[`item.paymentDate`]="{ item }">
          {{ item.paymentDate ? String(item.paymentDate).slice(0, 10) : '-' }}
        </template>

        <template #[`item.method`]="{ item }">
          <InlineSelect
            v-if="editor.isEditing(item)"
            field="method"
            :model-value="editor.editValue('method')"
            :items="methodOptions"
            :placeholder="t('payments.method.unset')"
            @update:model-value="editor.setEditValue('method', $event)"
          />
          <span v-else>{{ item.method ? t('payments.method.' + String(item.method)) : t('payments.method.unset') }}</span>
        </template>

        <template #[`item.reference`]="{ item }">
          <InlineTextField
            v-if="editor.isEditing(item)"
            field="reference"
            :model-value="editor.editValue('reference')"
            @update:model-value="editor.setEditValue('reference', $event)"
          />
          <span v-else class="cp-muted">{{ item.reference || '-' }}</span>
        </template>

        <template #[`item.actions`]="{ item }">
          <InlineTableActions
            :editing="editor.isEditing(item)"
            :saving="editor.saving.value"
            :can-edit="canEdit"
            :can-delete="canDelete"
            @edit="editor.startEdit(item)"
            @save="saveEdit"
            @cancel="editor.cancelEdit()"
            @delete="remove(item)"
          />
        </template>

        <template #no-data>
          <div class="cp-empty">{{ t('projects.payments.empty') }}</div>
        </template>
      </DataTable>
    </template>

    <v-progress-linear v-else indeterminate />

    <AddPaymentDialog v-model="addOpen" :project-id="projectId" @created="onCreated" />
  </div>
</template>

<style scoped>
.cp-num {
  font-variant-numeric: tabular-nums;
}
.cp-muted {
  color: var(--cp-text-muted);
}
.cp-empty {
  padding: 28px 16px;
  text-align: center;
  color: var(--cp-text-muted);
}
.cp-inline-add > td {
  background: var(--cp-primary-soft);
  vertical-align: top;
}
:deep(tr.cp-inline-editing > td) {
  background: var(--cp-primary-soft);
  vertical-align: top;
}
</style>
