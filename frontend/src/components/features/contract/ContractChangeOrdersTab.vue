<script setup lang="ts">
// Change Orders for a contract: formal amendments (signed amount deltas) that
// shift the contract's revised total. Available once the contract is APPROVED.
// DRAFT orders can be approved / rejected / deleted; approved ones are permanent
// (reverse with a negative order). All writes are audited server-side.
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { t } from '@/i18n';
import { changeOrdersApi } from '@/services/api/changeOrders.api';
import { useApiError } from '@/composables/useApiError';
import { useToast } from '@/composables/useToast';
import { useConfirm } from '@/composables/useConfirm';
import { useCurrencyFormat } from '@/composables/useCurrencyFormat';
import { useAccess } from '@/composables/useAccess';
import { RoleName } from '@/types/enums';
import type { ContractWithRelations } from '@/types/contract';
import type { ChangeOrder, ChangeOrderStatus, ChangeOrderSummary } from '@/types/changeOrder';
import ErrorState from '@/components/shared/ErrorState.vue';
import EmptyState from '@/components/shared/EmptyState.vue';

const props = defineProps<{ contract: ContractWithRelations }>();

const { handle } = useApiError();
const toast = useToast();
const { confirm } = useConfirm();
const { format: money } = useCurrencyFormat();
const { canAccess } = useAccess();

const WRITE_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT];
const canCreate = computed(() => canAccess({ permissions: ['change_orders.create'], roles: WRITE_ROLES }));
const canApprove = computed(() => canAccess({ permissions: ['change_orders.approve'], roles: WRITE_ROLES }));
const canDelete = computed(() => canAccess({ permissions: ['change_orders.delete'], roles: WRITE_ROLES }));

const isApproved = computed(() => props.contract.status === 'APPROVED');

const orders = ref<ChangeOrder[]>([]);
const summary = ref<ChangeOrderSummary | null>(null);
const loading = ref(false);
const error = ref<unknown>(null);
const busyId = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const [list, sum] = await Promise.all([
      changeOrdersApi.listForContract(props.contract.id),
      changeOrdersApi.summary(props.contract.id),
    ]);
    orders.value = list.items;
    summary.value = sum;
  } catch (e) {
    error.value = e;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch(() => props.contract.id, load);

// ----- status presentation -----
const STATUS_COLOR: Record<ChangeOrderStatus, string> = {
  DRAFT: 'warning',
  APPROVED: 'success',
  REJECTED: 'error',
};
const isNegative = (amount: string) => Number(amount) < 0;
const signedAmount = (amount: string) => (Number(amount) > 0 ? '+' : '') + money(amount);

// ----- create dialog -----
const dialog = ref(false);
const submitting = ref(false);
const form = reactive<{ title: string; amount: number | null; description: string }>({
  title: '',
  amount: null,
  description: '',
});

function openCreate() {
  form.title = '';
  form.amount = null;
  form.description = '';
  dialog.value = true;
}

const amountRule = (v: number | null) =>
  (typeof v === 'number' && v !== 0) || t('changeOrders.errors.amountNonZero');
const titleRule = (v: string) => !!v?.trim() || t('errors.required');

const canSubmit = computed(
  () => !!form.title.trim() && typeof form.amount === 'number' && form.amount !== 0,
);

async function submitCreate() {
  if (!canSubmit.value) return;
  submitting.value = true;
  try {
    await changeOrdersApi.create({
      contractId: props.contract.id,
      title: form.title.trim(),
      description: form.description.trim() || null,
      amount: form.amount as number,
    });
    toast.success(t('changeOrders.toast.created'));
    dialog.value = false;
    await load();
  } catch (e) {
    handle(e);
  } finally {
    submitting.value = false;
  }
}

// ----- row actions -----
async function approve(co: ChangeOrder) {
  const ok = await confirm({
    title: t('changeOrders.confirm.approveTitle'),
    message: t('changeOrders.confirm.approveMessage', { title: co.title, amount: signedAmount(co.amount) }),
    confirmText: t('changeOrders.actions.approve'),
  });
  if (!ok) return;
  busyId.value = co.id;
  try {
    await changeOrdersApi.approve(co.id);
    toast.success(t('changeOrders.toast.approved'));
    await load();
  } catch (e) {
    handle(e);
  } finally {
    busyId.value = null;
  }
}

async function reject(co: ChangeOrder) {
  const ok = await confirm({
    title: t('changeOrders.confirm.rejectTitle'),
    message: t('changeOrders.confirm.rejectMessage', { title: co.title }),
    confirmText: t('changeOrders.actions.reject'),
    destructive: true,
  });
  if (!ok) return;
  busyId.value = co.id;
  try {
    await changeOrdersApi.reject(co.id);
    toast.success(t('changeOrders.toast.rejected'));
    await load();
  } catch (e) {
    handle(e);
  } finally {
    busyId.value = null;
  }
}

async function remove(co: ChangeOrder) {
  const ok = await confirm({
    title: t('changeOrders.confirm.deleteTitle'),
    message: t('changeOrders.confirm.deleteMessage', { title: co.title }),
    confirmText: t('common.delete'),
    destructive: true,
  });
  if (!ok) return;
  busyId.value = co.id;
  try {
    await changeOrdersApi.remove(co.id);
    toast.success(t('common.deleted'));
    await load();
  } catch (e) {
    handle(e);
  } finally {
    busyId.value = null;
  }
}
</script>

<template>
  <div>
    <ErrorState v-if="error" :error="error" class="my-2" @retry="load" />

    <template v-else>
      <!-- Revised-total summary -->
      <div v-if="summary" class="cp-co-summary mb-4">
        <div class="cp-co-stat">
          <span class="cp-co-stat__label">{{ t('changeOrders.summary.original') }}</span>
          <span class="cp-co-stat__value">{{ money(summary.originalTotal) }}</span>
        </div>
        <v-icon icon="mdi-plus" size="16" class="text-medium-emphasis" />
        <div class="cp-co-stat">
          <span class="cp-co-stat__label">{{ t('changeOrders.summary.delta') }}</span>
          <span
            class="cp-co-stat__value"
            :class="isNegative(summary.approvedDelta) ? 'text-error' : 'text-success'"
          >
            {{ signedAmount(summary.approvedDelta) }}
          </span>
        </div>
        <v-icon icon="mdi-equal" size="16" class="text-medium-emphasis" />
        <div class="cp-co-stat cp-co-stat--revised">
          <span class="cp-co-stat__label">{{ t('changeOrders.summary.revised') }}</span>
          <span class="cp-co-stat__value">{{ money(summary.revisedTotal) }}</span>
        </div>
      </div>

      <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
        <p class="text-caption text-medium-emphasis m-0">{{ t('changeOrders.hint') }}</p>
        <v-btn
          v-if="canCreate"
          color="primary"
          size="small"
          prepend-icon="mdi-plus"
          :disabled="!isApproved"
          @click="openCreate"
        >
          {{ t('changeOrders.add') }}
        </v-btn>
      </div>

      <v-alert
        v-if="!isApproved"
        type="info"
        variant="tonal"
        density="comfortable"
        icon="mdi-information-outline"
        class="mb-3 text-sm"
      >
        {{ t('changeOrders.notApprovedHint') }}
      </v-alert>

      <div v-if="loading && !orders.length" class="space-y-2">
        <v-skeleton-loader v-for="i in 2" :key="i" type="list-item-two-line" />
      </div>

      <EmptyState
        v-else-if="!orders.length"
        :title="t('changeOrders.empty')"
        icon="mdi-file-document-edit-outline"
        compact
      />

      <ul v-else class="cp-co-list">
        <li v-for="co in orders" :key="co.id" class="cp-co-row">
          <div class="cp-co-row__num">#{{ co.number }}</div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-medium truncate">{{ co.title }}</span>
              <v-chip :color="STATUS_COLOR[co.status]" size="x-small" variant="tonal">
                {{ t('changeOrders.status.' + co.status) }}
              </v-chip>
            </div>
            <div v-if="co.description" class="text-caption text-medium-emphasis truncate">
              {{ co.description }}
            </div>
          </div>
          <div
            class="cp-co-row__amount tabular-nums"
            :class="isNegative(co.amount) ? 'text-error' : 'text-success'"
          >
            {{ signedAmount(co.amount) }}
          </div>
          <div class="cp-co-row__actions">
            <template v-if="co.status === 'DRAFT'">
              <v-btn
                v-if="canApprove"
                icon="mdi-check"
                size="small"
                variant="text"
                color="success"
                :loading="busyId === co.id"
                :aria-label="t('changeOrders.actions.approve')"
                @click="approve(co)"
              />
              <v-btn
                v-if="canApprove"
                icon="mdi-close"
                size="small"
                variant="text"
                color="warning"
                :disabled="busyId === co.id"
                :aria-label="t('changeOrders.actions.reject')"
                @click="reject(co)"
              />
              <v-btn
                v-if="canDelete"
                icon="mdi-delete-outline"
                size="small"
                variant="text"
                color="error"
                :disabled="busyId === co.id"
                :aria-label="t('common.delete')"
                @click="remove(co)"
              />
            </template>
          </div>
        </li>
      </ul>
    </template>

    <!-- Create dialog -->
    <v-dialog v-model="dialog" max-width="520" :persistent="submitting">
      <v-card>
        <v-card-title>{{ t('changeOrders.add') }}</v-card-title>
        <v-form @submit.prevent="submitCreate">
          <v-card-text class="grid grid-cols-1 gap-3">
            <v-text-field
              v-model="form.title"
              :label="t('changeOrders.fields.title')"
              :placeholder="t('changeOrders.fields.titlePlaceholder')"
              :rules="[titleRule]"
              autofocus
            />
            <v-text-field
              v-model.number="form.amount"
              :label="t('changeOrders.fields.amount')"
              :hint="t('changeOrders.fields.amountHint')"
              persistent-hint
              type="number"
              step="0.01"
              :rules="[amountRule]"
            />
            <v-textarea
              v-model="form.description"
              :label="t('changeOrders.fields.description')"
              rows="2"
              auto-grow
            />
          </v-card-text>
          <v-divider />
          <v-card-actions class="px-4 py-3">
            <v-btn variant="text" :disabled="submitting" @click="dialog = false">
              {{ t('common.cancel') }}
            </v-btn>
            <v-spacer />
            <v-btn
              type="submit"
              color="primary"
              variant="flat"
              :loading="submitting"
              :disabled="!canSubmit"
            >
              {{ t('changeOrders.add') }}
            </v-btn>
          </v-card-actions>
        </v-form>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.cp-co-summary {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 12px 14px;
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius-md);
  background: var(--cp-surface-2);
}
.cp-co-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cp-co-stat__label {
  font-size: 0.7rem;
  color: var(--cp-text-muted);
}
.cp-co-stat__value {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.cp-co-stat--revised {
  margin-inline-start: auto;
}
.cp-co-stat--revised .cp-co-stat__value {
  font-size: 1.1rem;
  color: var(--cp-primary);
}
.cp-co-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.cp-co-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius-md);
  background: var(--cp-surface);
}
.cp-co-row__num {
  font-weight: 700;
  color: var(--cp-text-muted);
  flex-shrink: 0;
}
.cp-co-row__amount {
  font-weight: 700;
  flex-shrink: 0;
}
.cp-co-row__actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
</style>
