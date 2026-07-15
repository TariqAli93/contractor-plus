<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { t } from '@/i18n';
import { costsApi } from '@/services/api/costs.api';
import { useApiError } from '@/composables/useApiError';
import { useToast } from '@/composables/useToast';
import { useAccess } from '@/composables/useAccess';
import { useConfirm } from '@/composables/useConfirm';
import { useCurrencyFormat } from '@/composables/useCurrencyFormat';
import { numOrNull } from '@/lib/number';
import { CostCategory, RoleName } from '@/types/enums';
import type {
  CostWithMaterial,
  CreateCostInput,
  ProjectCostSummary,
  UpdateCostInput,
} from '@/types/cost';
import DataTable from '@/components/shared/DataTable.vue';
import InlineTextField from '@/components/shared/table/InlineTextField.vue';
import InlineSelect from '@/components/shared/table/InlineSelect.vue';
import InlineTableActions from '@/components/shared/table/InlineTableActions.vue';
import { useInlineTableEditor } from '@/components/shared/table/useInlineTableEditor';
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

const ADD_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT, RoleName.ENGINEER];
const DELETE_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT];
const ADD_PERMS = ['costs.create'];
const canEdit = computed(() => canAccess({ permissions: ['costs.update'], roles: ADD_ROLES }));
const canDelete = computed(() => canAccess({ permissions: ['costs.delete'], roles: DELETE_ROLES }));

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

const headers = computed(() => [
  { title: t('projects.costs.fields.date'), key: 'date', width: 140 },
  { title: t('projects.costs.fields.category'), key: 'category', width: 140 },
  { title: t('projects.costs.fields.description'), key: 'description', minWidth: 200 },
  { title: t('projects.costs.fields.quantity'), key: 'quantity', align: 'end', width: 110 },
  { title: t('projects.costs.fields.unitPrice'), key: 'unitPrice', align: 'end', width: 130 },
  { title: t('projects.costs.fields.totalAmount'), key: 'totalAmount', align: 'end', width: 140 },
  { title: '', key: 'actions', align: 'end', sortable: false, width: 92 },
]);

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const editor = useInlineTableEditor<CostWithMaterial>({
  newDraft: () => ({
    category: CostCategory.MATERIAL,
    description: '',
    quantity: null,
    unitPrice: null,
    totalAmount: null,
    date: todayIso(),
  }),
  toDraft: (row) => ({
    category: row.category,
    description: row.description,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    totalAmount: row.totalAmount,
    date: String(row.date).slice(0, 10),
  }),
});

/** Total is derived from qty × unitPrice; only typeable when one is blank. */
const totalEditable = (draft: Record<string, unknown> | null) =>
  !!draft && (numOrNull(draft.quantity) == null || numOrNull(draft.unitPrice) == null);

function totalDisplay(row: { quantity: unknown; unitPrice: unknown; totalAmount: unknown }): string {
  const q = numOrNull(row.quantity);
  const p = numOrNull(row.unitPrice);
  const val = q != null && p != null ? q * p : numOrNull(row.totalAmount);
  return val == null ? '' : money(val);
}
const draftTotalDisplay = (draft: Record<string, unknown> | null) =>
  draft ? totalDisplay(draft as { quantity: unknown; unitPrice: unknown; totalAmount: unknown }) : '';

function rowProps({ item }: { item: CostWithMaterial }) {
  return editor.isEditing(item) ? { class: 'cp-inline-editing' } : {};
}

function validate(draft: Record<string, unknown>): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!String(draft.description ?? '').trim()) errs.description = t('inline.required');
  if (!draft.date) errs.date = t('inline.required');
  if (!draft.category) errs.category = t('inline.required');
  const q = numOrNull(draft.quantity);
  const p = numOrNull(draft.unitPrice);
  const tot = numOrNull(draft.totalAmount);
  if (!(q != null && p != null) && tot == null) errs.totalAmount = t('projects.costs.quickAddInvalid');
  return errs;
}

function toPatch(draft: Record<string, unknown>): UpdateCostInput {
  const patch: UpdateCostInput = {
    category: draft.category as CostCategory,
    description: String(draft.description ?? '').trim(),
    date: String(draft.date),
  };
  const q = numOrNull(draft.quantity);
  const p = numOrNull(draft.unitPrice);
  patch.quantity = q;
  patch.unitPrice = p;
  if (q == null || p == null) {
    const tot = numOrNull(draft.totalAmount);
    if (tot != null) patch.totalAmount = tot;
  }
  return patch;
}
function toCreate(draft: Record<string, unknown>): CreateCostInput {
  const q = numOrNull(draft.quantity);
  const p = numOrNull(draft.unitPrice);
  const tot = numOrNull(draft.totalAmount);
  const hasPair = q != null && p != null;
  return {
    projectId: props.projectId,
    category: (draft.category as CostCategory) ?? CostCategory.MATERIAL,
    description: String(draft.description ?? '').trim(),
    quantity: q,
    unit: null,
    unitPrice: p,
    ...(!hasPair && tot != null ? { totalAmount: tot } : {}),
    date: draft.date ? String(draft.date) : todayIso(),
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
      await costsApi.create(toCreate(draft));
      toast.success(t('projects.costs.costCreated'));
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
      await costsApi.update(String(id), toPatch(draft));
      await refresh();
      emit('changed');
    } catch (e) {
      handle(e);
      throw e;
    }
  });
  if (ok) editor.cancelEdit();
}

async function remove(row: CostWithMaterial) {
  const ok = await confirm({
    title: t('projects.costs.deleteTitle'),
    message: t('projects.costs.deleteMsg', { name: row.description }),
    confirmText: t('common.delete'),
    destructive: true,
  });
  if (!ok) return;
  try {
    await costsApi.remove(row.id);
    toast.success(t('common.deleted'));
    await refresh();
    emit('changed');
  } catch (e) {
    handle(e);
  }
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
        <RoleGate :permissions="ADD_PERMS" :roles="ADD_ROLES">
          <v-btn
            size="small"
            variant="tonal"
            prepend-icon="mdi-plus"
            :disabled="editor.busy.value"
            @click="editor.startCreate()"
          >
            {{ t('projects.costs.quickAdd') }}
          </v-btn>
        </RoleGate>
      </div>

      <DataTable
        :server="false"
        :items="costs"
        :items-length="costs.length"
        :headers="headers"
        :loading="loading"
        item-value="id"
        :items-per-page="25"
        :items-per-page-options="[25, 50, 100]"
        :row-props="rowProps"
        :aria-label="t('projects.costs.title')"
      >
        <template #body.prepend>
          <tr v-if="editor.isCreating.value" class="cp-inline-add">
            <td>
              <InlineTextField
                field="date"
                kind="date"
                :model-value="editor.createValue('date')"
                :error="editor.errorFor('date')"
                @update:model-value="editor.setCreateValue('date', $event)"
              />
            </td>
            <td>
              <InlineSelect
                field="category"
                :model-value="editor.createValue('category')"
                :items="categories"
                :error="editor.errorFor('category')"
                @update:model-value="editor.setCreateValue('category', $event)"
              />
            </td>
            <td>
              <InlineTextField
                field="description"
                :model-value="editor.createValue('description')"
                :placeholder="t('projects.costs.fields.description')"
                :error="editor.errorFor('description')"
                autofocus
                @update:model-value="editor.setCreateValue('description', $event)"
              />
            </td>
            <td>
              <InlineTextField
                field="quantity"
                kind="number"
                :model-value="editor.createValue('quantity')"
                :step="0.001"
                :min="0"
                @update:model-value="editor.setCreateValue('quantity', $event)"
              />
            </td>
            <td>
              <InlineTextField
                field="unitPrice"
                kind="money"
                :model-value="editor.createValue('unitPrice')"
                :step="0.01"
                :min="0"
                @update:model-value="editor.setCreateValue('unitPrice', $event)"
              />
            </td>
            <td>
              <InlineTextField
                v-if="totalEditable(editor.creatingDraft.value)"
                field="totalAmount"
                kind="money"
                :model-value="editor.createValue('totalAmount')"
                :step="0.01"
                :min="0"
                :error="editor.errorFor('totalAmount')"
                @update:model-value="editor.setCreateValue('totalAmount', $event)"
              />
              <span v-else class="cp-num">{{ draftTotalDisplay(editor.creatingDraft.value) }}</span>
            </td>
            <td>
              <InlineTableActions editing :saving="editor.saving.value" @save="saveCreate" @cancel="editor.cancelCreate()" />
            </td>
          </tr>
        </template>

        <template #[`item.date`]="{ item }">
          <InlineTextField
            v-if="editor.isEditing(item)"
            field="date"
            kind="date"
            :model-value="editor.editValue('date')"
            :error="editor.errorFor('date')"
            @update:model-value="editor.setEditValue('date', $event)"
          />
          <span v-else>{{ String(item.date).slice(0, 10) }}</span>
        </template>

        <template #[`item.category`]="{ item }">
          <InlineSelect
            v-if="editor.isEditing(item)"
            field="category"
            :model-value="editor.editValue('category')"
            :items="categories"
            :error="editor.errorFor('category')"
            @update:model-value="editor.setEditValue('category', $event)"
          />
          <span v-else>{{ t('costs.category.' + String(item.category)) }}</span>
        </template>

        <template #[`item.description`]="{ item }">
          <InlineTextField
            v-if="editor.isEditing(item)"
            field="description"
            :model-value="editor.editValue('description')"
            :error="editor.errorFor('description')"
            @update:model-value="editor.setEditValue('description', $event)"
          />
          <span v-else>{{ item.description }}</span>
        </template>

        <template #[`item.quantity`]="{ item }">
          <InlineTextField
            v-if="editor.isEditing(item)"
            field="quantity"
            kind="number"
            :model-value="editor.editValue('quantity')"
            :step="0.001"
            :min="0"
            @update:model-value="editor.setEditValue('quantity', $event)"
          />
          <span v-else class="cp-num">{{ item.quantity ?? '' }}</span>
        </template>

        <template #[`item.unitPrice`]="{ item }">
          <InlineTextField
            v-if="editor.isEditing(item)"
            field="unitPrice"
            kind="money"
            :model-value="editor.editValue('unitPrice')"
            :step="0.01"
            :min="0"
            @update:model-value="editor.setEditValue('unitPrice', $event)"
          />
          <span v-else class="cp-num">{{ item.unitPrice != null ? money(Number(item.unitPrice)) : '' }}</span>
        </template>

        <template #[`item.totalAmount`]="{ item }">
          <template v-if="editor.isEditing(item)">
            <InlineTextField
              v-if="totalEditable(editor.editingDraft.value)"
              field="totalAmount"
              kind="money"
              :model-value="editor.editValue('totalAmount')"
              :step="0.01"
              :min="0"
              :error="editor.errorFor('totalAmount')"
              @update:model-value="editor.setEditValue('totalAmount', $event)"
            />
            <span v-else class="cp-num">{{ draftTotalDisplay(editor.editingDraft.value) }}</span>
          </template>
          <span v-else class="cp-num">{{ totalDisplay(item) }}</span>
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
          <div class="cp-empty">{{ t('projects.costs.empty') }}</div>
        </template>
      </DataTable>
    </template>

    <v-progress-linear v-else indeterminate />

    <AddCostDialog v-model="addOpen" :project-id="projectId" @created="onCreated" />
  </div>
</template>

<style scoped>
.cp-num {
  font-variant-numeric: tabular-nums;
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
