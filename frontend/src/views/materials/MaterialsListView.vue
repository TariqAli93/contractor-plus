<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { t } from '@/i18n';
import { materialsApi } from '@/services/api/materials.api';
import { useApiError } from '@/composables/useApiError';
import { useToast } from '@/composables/useToast';
import { useAccess } from '@/composables/useAccess';
import { useConfirm } from '@/composables/useConfirm';
import { useCurrencyFormat } from '@/composables/useCurrencyFormat';
import { numOrNull } from '@/lib/number';
import { RoleName } from '@/types/enums';
import type { CreateMaterialInput, Material, UpdateMaterialInput } from '@/types/material';
import type {
  GridCellCommit,
  GridColumn,
  GridPastePayload,
  GridRow,
} from '@/components/shared/datagrid/types';
import DataGrid from '@/components/shared/datagrid/DataGrid.vue';
import { buildMaterialColumns } from '@/components/features/material/materialGridColumns';
import ErrorState from '@/components/shared/ErrorState.vue';
import RoleGate from '@/components/shared/RoleGate.vue';

const { handle } = useApiError();
const toast = useToast();
const { canAccess } = useAccess();
const { confirm } = useConfirm();
const { format: money } = useCurrencyFormat();

const WRITE_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT];
const canCreate = computed(() => canAccess({ permissions: ['materials.create'], roles: WRITE_ROLES }));
const canEdit = computed(() => canAccess({ permissions: ['materials.update'], roles: WRITE_ROLES }));
const canDelete = computed(() => canAccess({ permissions: ['materials.delete'], roles: WRITE_ROLES }));

const materials = ref<Material[]>([]);
const total = ref(0);
const loading = ref(false);
const error = ref<unknown>(null);

// The grid is client-paged; pull every material (capped) so sort/filter/export
// operate over the full catalogue. Virtualization for very large sets is a
// later optimization.
const CAP = 1000;
async function refresh() {
  loading.value = true;
  error.value = null;
  try {
    const collected: Material[] = [];
    let page = 1;
    let totalCount = 0;
    do {
      const res = await materialsApi.list({ page, pageSize: 100, sortBy: 'name', sortDir: 'asc' });
      collected.push(...res.items);
      totalCount = res.total;
      page++;
    } while (collected.length < totalCount && collected.length < CAP);
    materials.value = collected;
    total.value = totalCount;
  } catch (e) {
    error.value = e;
    handle(e);
  } finally {
    loading.value = false;
  }
}
onMounted(refresh);

const columns = computed<GridColumn[]>(() => buildMaterialColumns({ t, money }));
const gridRows = computed<GridRow[]>(() => materials.value as unknown as GridRow[]);

function newRowFactory(): Record<string, unknown> {
  return { name: '', unit: '', defaultPrice: null, isActive: true, notes: '' };
}

function materialPatch(values: Record<string, unknown>): UpdateMaterialInput {
  const patch: UpdateMaterialInput = {};
  if ('name' in values) patch.name = String(values.name ?? '').trim();
  if ('unit' in values) patch.unit = String(values.unit ?? '').trim();
  if ('notes' in values) patch.notes = values.notes == null || values.notes === '' ? null : String(values.notes);
  if ('defaultPrice' in values) patch.defaultPrice = numOrNull(values.defaultPrice);
  if ('isActive' in values) patch.isActive = values.isActive === true || values.isActive === 'true';
  return patch;
}

function buildCreate(values: Record<string, unknown>): CreateMaterialInput | null {
  const name = String(values.name ?? '').trim();
  const unit = String(values.unit ?? '').trim();
  if (!name || !unit) return null;
  return {
    name,
    unit,
    defaultPrice: numOrNull(values.defaultPrice),
    notes: values.notes == null || values.notes === '' ? null : String(values.notes),
    isActive: !(values.isActive === false || values.isActive === 'false'),
  };
}

async function onCellCommit(p: GridCellCommit) {
  try {
    await materialsApi.update(p.id, materialPatch({ [p.field]: p.value }));
    await refresh();
  } catch (e) {
    handle(e);
    await refresh();
  }
}

async function onNewCommit(values: Record<string, unknown>) {
  const payload = buildCreate(values);
  if (!payload) {
    toast.error(t('materials.gridAddInvalid'));
    return;
  }
  try {
    await materialsApi.create(payload);
    toast.success(t('common.saved'));
    await refresh();
  } catch (e) {
    handle(e);
  }
}

async function onPaste(payload: GridPastePayload) {
  try {
    for (const u of payload.updates) await materialsApi.update(u.id, materialPatch(u.values));
    let skipped = 0;
    for (const row of payload.creates) {
      const create = buildCreate(row);
      if (create) await materialsApi.create(create);
      else skipped++;
    }
    toast.success(t('datagrid.pasteApplied'));
    if (skipped > 0) toast.error(t('datagrid.pasteSkipped'));
    await refresh();
  } catch (e) {
    handle(e);
    await refresh();
  }
}

async function onDeleteRows(ids: string[]) {
  const ok = await confirm({
    title: t('materials.deleteManyTitle'),
    message: t('materials.deleteManyMessage').replace('{n}', String(ids.length)),
    confirmText: t('common.delete'),
    destructive: true,
  });
  if (!ok) return;
  try {
    for (const id of ids) await materialsApi.remove(id);
    toast.success(t('common.deleted'));
    await refresh();
  } catch (e) {
    handle(e);
    await refresh();
  }
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-4 gap-2 flex-wrap">
      <h1 class="text-h5">{{ t('nav.materials') }}</h1>
      <RoleGate :permissions="['materials.create']" :roles="WRITE_ROLES">
        <v-btn color="primary" prepend-icon="mdi-plus" to="/materials/new">
          {{ t('materials.new') }}
        </v-btn>
      </RoleGate>
    </div>

    <p class="text-caption text-medium-emphasis mb-2">{{ t('datagrid.hint') }}</p>

    <ErrorState v-if="error" :error="error" class="my-4" @retry="refresh" />

    <DataGrid
      v-else
      :rows="gridRows"
      :columns="columns"
      :editable="canEdit"
      :show-new-row="canCreate"
      :new-row-factory="newRowFactory"
      :selectable="canDelete"
      :enable-csv="true"
      export-name="materials"
      :loading="loading"
      height="600px"
      @cell-commit="onCellCommit"
      @new-commit="onNewCommit"
      @paste="onPaste"
      @delete-rows="onDeleteRows"
    />

    <p v-if="total > materials.length" class="text-caption text-medium-emphasis mt-2">
      {{ t('datagrid.truncated').replace('{shown}', String(materials.length)).replace('{total}', String(total)) }}
    </p>
  </div>
</template>
