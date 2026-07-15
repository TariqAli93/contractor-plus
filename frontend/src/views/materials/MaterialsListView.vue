<script setup lang="ts">
// Materials catalogue: a native Vuetify data table with inline row creation and
// whole-row inline editing. The page owns fields, validation, permissions and
// the API; the table owns only draft/edit state (via useInlineTableEditor).
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
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
import DataTable from '@/components/shared/DataTable.vue';
import ErrorState from '@/components/shared/ErrorState.vue';
import RoleGate from '@/components/shared/RoleGate.vue';
import PageHeader from '@/components/shared/PageHeader.vue';
import SearchBar from '@/components/shared/SearchBar.vue';
import InlineTextField from '@/components/shared/table/InlineTextField.vue';
import InlineTableActions from '@/components/shared/table/InlineTableActions.vue';
import { useInlineTableEditor } from '@/components/shared/table/useInlineTableEditor';

const { handle } = useApiError();
const toast = useToast();
const { canAccess } = useAccess();
const { confirm } = useConfirm();
const { format: money } = useCurrencyFormat();
const router = useRouter();

const WRITE_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT];
const canEdit = computed(() => canAccess({ permissions: ['materials.update'], roles: WRITE_ROLES }));
const canDelete = computed(() => canAccess({ permissions: ['materials.delete'], roles: WRITE_ROLES }));

const materials = ref<Material[]>([]);
const total = ref(0);
const loading = ref(false);
const error = ref<unknown>(null);
const search = ref('');

// Client-side table: pull the whole catalogue (capped) once.
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

const headers = computed(() => [
  { title: t('materials.fields.name'), key: 'name', minWidth: 200 },
  { title: t('materials.fields.unit'), key: 'unit', width: 120 },
  { title: t('materials.fields.defaultPrice'), key: 'defaultPrice', align: 'end', width: 150 },
  { title: t('materials.fields.isActive'), key: 'isActive', width: 120 },
  { title: t('materials.fields.notes'), key: 'notes', minWidth: 180 },
  { title: '', key: 'actions', align: 'end', sortable: false, width: 108 },
]);

const editor = useInlineTableEditor<Material>({
  newDraft: () => ({ name: '', unit: '', defaultPrice: null, isActive: true, notes: '' }),
  toDraft: (row) => ({
    name: row.name,
    unit: row.unit,
    defaultPrice: row.defaultPrice,
    isActive: row.isActive,
    notes: row.notes ?? '',
  }),
});

function rowProps({ item }: { item: Material }) {
  return editor.isEditing(item) ? { class: 'cp-inline-editing' } : {};
}

function validate(draft: Record<string, unknown>): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!String(draft.name ?? '').trim()) errs.name = t('inline.required');
  if (!String(draft.unit ?? '').trim()) errs.unit = t('inline.required');
  return errs;
}

function toPatch(draft: Record<string, unknown>): UpdateMaterialInput {
  return {
    name: String(draft.name ?? '').trim(),
    unit: String(draft.unit ?? '').trim(),
    defaultPrice: numOrNull(draft.defaultPrice),
    notes: draft.notes == null || draft.notes === '' ? null : String(draft.notes),
    isActive: draft.isActive === true,
  };
}
function toCreate(draft: Record<string, unknown>): CreateMaterialInput {
  return {
    name: String(draft.name ?? '').trim(),
    unit: String(draft.unit ?? '').trim(),
    defaultPrice: numOrNull(draft.defaultPrice),
    notes: draft.notes == null || draft.notes === '' ? null : String(draft.notes),
    isActive: draft.isActive !== false,
  };
}

async function saveCreate() {
  const draft = editor.creatingDraft.value;
  if (!draft) return;
  const errs = validate(draft);
  if (Object.keys(errs).length) return editor.setErrors(errs);
  const ok = await editor.runSave(async () => {
    try {
      await materialsApi.create(toCreate(draft));
      toast.success(t('common.saved'));
      await refresh();
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
      await materialsApi.update(String(id), toPatch(draft));
      toast.success(t('common.saved'));
      await refresh();
    } catch (e) {
      handle(e);
      throw e;
    }
  });
  if (ok) editor.cancelEdit();
}

async function remove(row: Material) {
  const ok = await confirm({
    title: t('materials.deleteConfirmTitle'),
    message: t('materials.deleteConfirmMessage', { name: row.name }),
    confirmText: t('common.delete'),
    destructive: true,
  });
  if (!ok) return;
  try {
    await materialsApi.remove(row.id);
    toast.success(t('common.deleted'));
    await refresh();
  } catch (e) {
    handle(e);
  }
}
</script>

<template>
  <div class="cp-fill">
    <PageHeader
      :title="t('nav.materials')"
      icon="mdi-cube-outline"
      :count="total || null"
      :hint="t('help.materials')"
    >
      <RoleGate :permissions="['materials.create']" :roles="WRITE_ROLES">
        <v-btn
          color="primary"
          size="small"
          variant="flat"
          prepend-icon="mdi-plus"
          :disabled="editor.busy.value"
          @click="editor.startCreate()"
        >
          {{ t('materials.new') }}
        </v-btn>
      </RoleGate>
    </PageHeader>

    <ErrorState v-if="error" :error="error" class="ma-3" @retry="refresh" />

    <div v-else class="cp-pane">
      <div class="cp-pane__toolbar">
        <SearchBar v-model="search" :placeholder="t('materials.searchPlaceholder')" />
      </div>

      <div class="cp-pane__body">
        <DataTable
          :server="false"
          :items="materials"
          :items-length="materials.length"
          :headers="headers"
          :loading="loading"
          :search="search"
          item-value="id"
          :items-per-page="25"
          :items-per-page-options="[25, 50, 100, 200]"
          :row-props="rowProps"
          :aria-label="t('nav.materials')"
        >
          <!-- Inline create row, pinned above the records. -->
          <template #body.prepend>
            <tr v-if="editor.isCreating.value" class="cp-inline-add">
              <td>
                <InlineTextField
                  field="name"
                  :model-value="editor.createValue('name')"
                  :placeholder="t('materials.fields.name')"
                  :error="editor.errorFor('name')"
                  autofocus
                  @update:model-value="editor.setCreateValue('name', $event)"
                />
              </td>
              <td>
                <InlineTextField
                  field="unit"
                  :model-value="editor.createValue('unit')"
                  :placeholder="t('materials.fields.unit')"
                  :error="editor.errorFor('unit')"
                  @update:model-value="editor.setCreateValue('unit', $event)"
                />
              </td>
              <td>
                <InlineTextField
                  field="defaultPrice"
                  kind="money"
                  :model-value="editor.createValue('defaultPrice')"
                  :step="0.01"
                  :min="0"
                  @update:model-value="editor.setCreateValue('defaultPrice', $event)"
                />
              </td>
              <td>
                <v-switch
                  :model-value="editor.createValue('isActive') !== false"
                  color="primary"
                  density="compact"
                  hide-details
                  inset
                  @update:model-value="editor.setCreateValue('isActive', $event === true)"
                />
              </td>
              <td>
                <InlineTextField
                  field="notes"
                  kind="multiline"
                  :model-value="editor.createValue('notes')"
                  :placeholder="t('materials.fields.notes')"
                  @update:model-value="editor.setCreateValue('notes', $event)"
                />
              </td>
              <td>
                <InlineTableActions editing :saving="editor.saving.value" @save="saveCreate" @cancel="editor.cancelCreate()" />
              </td>
            </tr>
          </template>

          <template #[`item.name`]="{ item }">
            <InlineTextField
              v-if="editor.isEditing(item)"
              field="name"
              :model-value="editor.editValue('name')"
              :error="editor.errorFor('name')"
              @update:model-value="editor.setEditValue('name', $event)"
            />
            <span v-else>{{ item.name }}</span>
          </template>

          <template #[`item.unit`]="{ item }">
            <InlineTextField
              v-if="editor.isEditing(item)"
              field="unit"
              :model-value="editor.editValue('unit')"
              :error="editor.errorFor('unit')"
              @update:model-value="editor.setEditValue('unit', $event)"
            />
            <span v-else>{{ item.unit }}</span>
          </template>

          <template #[`item.defaultPrice`]="{ item }">
            <InlineTextField
              v-if="editor.isEditing(item)"
              field="defaultPrice"
              kind="money"
              :model-value="editor.editValue('defaultPrice')"
              :step="0.01"
              :min="0"
              @update:model-value="editor.setEditValue('defaultPrice', $event)"
            />
            <span v-else class="cp-num">{{ item.defaultPrice != null ? money(Number(item.defaultPrice)) : '-' }}</span>
          </template>

          <template #[`item.isActive`]="{ item }">
            <v-switch
              v-if="editor.isEditing(item)"
              :model-value="editor.editValue('isActive') === true"
              color="primary"
              density="compact"
              hide-details
              inset
              @update:model-value="editor.setEditValue('isActive', $event === true)"
            />
            <v-chip v-else size="x-small" :color="item.isActive ? 'success' : undefined" variant="tonal">
              {{ item.isActive ? t('materials.status.active') : t('materials.status.inactive') }}
            </v-chip>
          </template>

          <template #[`item.notes`]="{ item }">
            <InlineTextField
              v-if="editor.isEditing(item)"
              field="notes"
              kind="multiline"
              :model-value="editor.editValue('notes')"
              @update:model-value="editor.setEditValue('notes', $event)"
            />
            <span v-else class="cp-muted">{{ item.notes || '-' }}</span>
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
            >
              <v-tooltip :text="t('materials.openDetail')" location="top">
                <template #activator="{ props: tip }">
                  <v-btn
                    v-bind="tip"
                    icon="mdi-open-in-new"
                    size="x-small"
                    variant="text"
                    :aria-label="t('materials.openDetail')"
                    @click="router.push(`/materials/${item.id}`)"
                  />
                </template>
              </v-tooltip>
            </InlineTableActions>
          </template>

          <template #no-data>
            <div class="cp-empty">{{ t('materials.empty') }}</div>
          </template>
        </DataTable>
      </div>
    </div>
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
  padding: 32px 16px;
  text-align: center;
  color: var(--cp-text-muted);
}
/* The create row and the row being edited get a calm native wash - no stripe. */
.cp-inline-add > td {
  background: var(--cp-primary-soft);
  vertical-align: top;
}
:deep(tr.cp-inline-editing > td) {
  background: var(--cp-primary-soft);
  vertical-align: top;
}
</style>
