<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { t } from '@/i18n';
import { costsApi } from '@/services/api/costs.api';
import { useApiError } from '@/composables/useApiError';
import { useToast } from '@/composables/useToast';
import { useAccess } from '@/composables/useAccess';
import { useConfirm } from '@/composables/useConfirm';
import { useCurrencyFormat } from '@/composables/useCurrencyFormat';
import { CostCategory, RoleName } from '@/types/enums';
import type {
  CostWithMaterial,
  CreateCostInput,
  ProjectCostSummary,
  UpdateCostInput,
} from '@/types/cost';
import type {
  GridCellCommit,
  GridColumn,
  GridPastePayload,
  GridRow,
  GridRowAction,
} from '@/components/shared/datagrid/types';
import DataGrid from '@/components/shared/datagrid/DataGrid.vue';
import { buildCostColumns, numOrNull } from '@/components/features/cost/costGridColumns';
import SummaryCard from '@/components/shared/SummaryCard.vue';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';
import ErrorState from '@/components/shared/ErrorState.vue';
import RoleGate from '@/components/shared/RoleGate.vue';
import AddCostDialog from './AddCostDialog.vue';

const props = defineProps<{ projectId: string }>();
const emit = defineEmits<{ (e: 'changed'): void }>();
const { handle } = useApiError();
const toast = useToast();
const { canAccess } = useAccess();
const { confirm } = useConfirm();
const { format: money } = useCurrencyFormat();

const ADD_ROLES: RoleName[] = [
  RoleName.OWNER,
  RoleName.ADMIN,
  RoleName.ACCOUNTANT,
  RoleName.ENGINEER,
];
const DELETE_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT];
const ADD_PERMS = ['costs.create'];
const EDIT_PERMS = ['costs.update'];
const DELETE_PERMS = ['costs.delete'];
const canAdd = computed(() => canAccess({ permissions: ADD_PERMS, roles: ADD_ROLES }));
const canEdit = computed(() => canAccess({ permissions: EDIT_PERMS, roles: ADD_ROLES }));
const canDelete = computed(() =>
  canAccess({ permissions: DELETE_PERMS, roles: DELETE_ROLES }),
);

const PAGE_SIZE = 100;
const summary = ref<ProjectCostSummary | null>(null);
const costs = ref<CostWithMaterial[]>([]);
const total = ref(0);
const loading = ref(false);
const error = ref<unknown>(null);

async function refresh() {
  loading.value = true;
  error.value = null;
  try {
    const [sum, list] = await Promise.all([
      costsApi.getProjectSummary(props.projectId),
      costsApi.listForProject(props.projectId, { pageSize: PAGE_SIZE }),
    ]);
    summary.value = sum;
    costs.value = list.items;
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

const categories = computed(() => [
  { value: CostCategory.MATERIAL, title: t('costs.category.MATERIAL') },
  { value: CostCategory.LABOR, title: t('costs.category.LABOR') },
  { value: CostCategory.MACHINERY, title: t('costs.category.MACHINERY') },
  { value: CostCategory.TRANSPORT, title: t('costs.category.TRANSPORT') },
  { value: CostCategory.MISC, title: t('costs.category.MISC') },
]);

const columns = computed<GridColumn[]>(() =>
  buildCostColumns({ t, money, categories: categories.value }),
);
// The grid reads rows structurally; CostWithMaterial carries the `id` key it
// needs. Cast through unknown to satisfy the generic GridRow index signature.
const gridRows = computed<GridRow[]>(() => costs.value as unknown as GridRow[]);

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function newRowFactory(): Record<string, unknown> {
  return {
    category: CostCategory.MATERIAL,
    description: '',
    quantity: null,
    unitPrice: null,
    totalAmount: null,
    date: todayIso(),
  };
}

// --------------------------------------------------------------------------
// Map grid values → cost API payloads. Editing quantity OR unitPrice always
// sends the pair so the backend recomputes the total; an explicit total is
// only sent when the pair can't derive one.
// --------------------------------------------------------------------------
function mergedPatch(
  existing: CostWithMaterial | undefined,
  values: Record<string, unknown>,
): UpdateCostInput {
  const patch: UpdateCostInput = {};
  if ('category' in values) patch.category = values.category as CostCategory;
  if ('description' in values) patch.description = String(values.description ?? '').trim();
  if ('date' in values && values.date) patch.date = String(values.date);
  const touchesQty = 'quantity' in values;
  const touchesPrice = 'unitPrice' in values;
  const touchesTotal = 'totalAmount' in values;
  if (touchesQty || touchesPrice) {
    const q = numOrNull(touchesQty ? values.quantity : existing?.quantity);
    const p = numOrNull(touchesPrice ? values.unitPrice : existing?.unitPrice);
    patch.quantity = q;
    patch.unitPrice = p;
    if ((q == null || p == null) && touchesTotal) {
      const tot = numOrNull(values.totalAmount);
      if (tot != null) patch.totalAmount = tot;
    }
  } else if (touchesTotal) {
    const tot = numOrNull(values.totalAmount);
    if (tot != null) patch.totalAmount = tot;
  }
  return patch;
}

function buildCreate(values: Record<string, unknown>): CreateCostInput | null {
  const description = String(values.description ?? '').trim();
  const q = numOrNull(values.quantity);
  const p = numOrNull(values.unitPrice);
  const tot = numOrNull(values.totalAmount);
  const hasPair = q != null && p != null;
  if (!description || (!hasPair && tot == null)) return null;
  return {
    projectId: props.projectId,
    category: (values.category as CostCategory) ?? CostCategory.MATERIAL,
    description,
    quantity: q,
    unit: null,
    unitPrice: p,
    ...(!hasPair && tot != null ? { totalAmount: tot } : {}),
    date: values.date ? String(values.date) : todayIso(),
    notes: null,
  };
}

// --------------------------------------------------------------------------
// Grid events
// --------------------------------------------------------------------------
async function onCellCommit(payload: GridCellCommit) {
  const existing = costs.value.find((c) => c.id === payload.id);
  try {
    await costsApi.update(payload.id, mergedPatch(existing, { [payload.field]: payload.value }));
    await refresh();
    emit('changed');
  } catch (e) {
    handle(e);
    await refresh(); // revert the optimistic cell to the server truth
  }
}

async function onNewCommit(values: Record<string, unknown>) {
  const payload = buildCreate(values);
  if (!payload) {
    toast.error(t('projects.costs.quickAddInvalid'));
    return;
  }
  try {
    await costsApi.create(payload);
    toast.success(t('projects.costs.costCreated'));
    await refresh();
    emit('changed');
  } catch (e) {
    handle(e);
  }
}

async function onPaste(payload: GridPastePayload) {
  try {
    for (const u of payload.updates) {
      const existing = costs.value.find((c) => c.id === u.id);
      await costsApi.update(u.id, mergedPatch(existing, u.values));
    }
    let created = 0;
    let skipped = 0;
    for (const row of payload.creates) {
      const create = buildCreate(row);
      if (create) {
        await costsApi.create(create);
        created++;
      } else {
        skipped++;
      }
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
    title: t('projects.costs.deleteTitle'),
    message: t('projects.costs.deleteManyMsg').replace('{n}', String(ids.length)),
    destructive: true,
    confirmText: t('common.delete'),
  });
  if (!ok) return;
  try {
    for (const id of ids) await costsApi.remove(id);
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

// Detailed add dialog (kept for material link / unit / notes).
const addOpen = ref(false);
async function onCreated() {
  await refresh();
  emit('changed');
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-3 gap-3 flex-wrap">
      <h2 class="text-h6">{{ t('projects.costs.title') }}</h2>
      <div class="flex items-center gap-2">
        <RoleGate :permissions="ADD_PERMS" :roles="ADD_ROLES">
          <v-btn variant="tonal" prepend-icon="mdi-cash-minus" @click="addOpen = true">
            {{ t('projects.costs.addDetailed') }}
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
        <SummaryCard :title="t('projects.costs.summary.totalCosts')" icon="mdi-cash-minus" :loading="loading">
          <MoneyDisplay :amount="summary.totalCosts" />
        </SummaryCard>
        <SummaryCard :title="t('projects.costs.summary.materials')" icon="mdi-cube-outline">
          <MoneyDisplay :amount="summary.materialCosts" />
        </SummaryCard>
        <SummaryCard :title="t('projects.costs.summary.labor')" icon="mdi-account-hard-hat-outline">
          <MoneyDisplay :amount="summary.laborCosts" />
        </SummaryCard>
        <SummaryCard :title="t('projects.costs.summary.machinery')" icon="mdi-tools">
          <MoneyDisplay :amount="summary.machineryCosts" />
        </SummaryCard>
        <SummaryCard :title="t('projects.costs.summary.transport')" icon="mdi-truck-outline">
          <MoneyDisplay :amount="summary.transportCosts" />
        </SummaryCard>
        <SummaryCard :title="t('projects.costs.summary.misc')" icon="mdi-dots-horizontal-circle-outline">
          <MoneyDisplay :amount="summary.miscCosts" />
        </SummaryCard>
        <SummaryCard :title="t('projects.costs.summary.count')" icon="mdi-counter">
          {{ summary.costCount }}
        </SummaryCard>
      </div>

      <div class="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <span class="text-h6">{{ t('projects.costs.latest') }}</span>
        <span v-if="canAdd || canEdit" class="text-caption text-medium-emphasis">
          {{ t('datagrid.hint') }}
        </span>
      </div>

      <DataGrid
        :rows="gridRows"
        :columns="columns"
        :editable="canEdit"
        :show-new-row="canAdd"
        :new-row-factory="newRowFactory"
        :selectable="canDelete"
        :row-actions="rowActions"
        :enable-csv="true"
        export-name="costs"
        :loading="loading"
        height="440px"
        @cell-commit="onCellCommit"
        @new-commit="onNewCommit"
        @paste="onPaste"
        @delete-rows="onDeleteRows"
      />

      <p v-if="total > costs.length" class="text-caption text-medium-emphasis mt-2">
        {{ t('datagrid.truncated').replace('{shown}', String(costs.length)).replace('{total}', String(total)) }}
      </p>
    </template>

    <v-progress-linear v-else indeterminate />

    <AddCostDialog v-model="addOpen" :project-id="projectId" @created="onCreated" />
  </div>
</template>
