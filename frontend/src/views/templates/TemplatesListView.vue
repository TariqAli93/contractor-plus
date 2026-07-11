<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { t } from '@/i18n';
import { useTemplates } from '@/composables/useTemplates';
import { useConfirm } from '@/composables/useConfirm';
import { useToast } from '@/composables/useToast';
import { useApiError } from '@/composables/useApiError';
import { templatesApi } from '@/services/api/templates.api';
import { buildTemplateColumns } from '@/components/features/template/templateColumns';
import { RoleName } from '@/types/enums';
import type { BuildingTemplate } from '@/types/template';
import SearchBar from '@/components/shared/SearchBar.vue';
import ErrorState from '@/components/shared/ErrorState.vue';
import RoleGate from '@/components/shared/RoleGate.vue';
import PageHeader from '@/components/shared/PageHeader.vue';
import DateDisplay from '@/components/shared/DateDisplay.vue';
import DataTable from '@/components/shared/DataTable.vue';
import WorkspaceSplit from '@/components/shared/workspace/WorkspaceSplit.vue';
import DetailsPane from '@/components/shared/workspace/DetailsPane.vue';
import PropertyGrid from '@/components/shared/workspace/PropertyGrid.vue';
import type { PropertyRow } from '@/components/shared/workspace/types';

const router = useRouter();
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
  isActive,
  sortBy,
  sortDir,
  fetch,
  setIsActiveFilter,
} = useTemplates();

const WRITE_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT];
const WRITE_PERMS = ['templates.create', 'templates.update', 'templates.delete'];

const columns = computed(() => buildTemplateColumns(t));

const filterValue = computed<'all' | 'active' | 'inactive'>(() => {
  if (isActive.value === true) return 'active';
  if (isActive.value === false) return 'inactive';
  return 'all';
});

function onFilterChange(v: 'all' | 'active' | 'inactive') {
  if (v === 'active') setIsActiveFilter(true);
  else if (v === 'inactive') setIsActiveFilter(false);
  else setIsActiveFilter(undefined);
}

onMounted(fetch);

function onTableUpdate(opts: {
  page: number;
  itemsPerPage: number;
  sortBy: Array<{ key: string; order: 'asc' | 'desc' }>;
}) {
  page.value = opts.page;
  pageSize.value = opts.itemsPerPage;
  const first = opts.sortBy[0];
  if (first && (first.key === 'name' || first.key === 'createdAt')) {
    sortBy.value = first.key;
    sortDir.value = first.order;
  } else if (opts.sortBy.length === 0) {
    sortBy.value = 'name';
    sortDir.value = 'asc';
  }
}

function openEdit(template: BuildingTemplate) {
  void router.push(`/templates/${template.id}`);
}

const selectedId = ref<string | null>(null);
const selected = computed<BuildingTemplate | null>(
  () => items.value.find((template) => template.id === selectedId.value) ?? null,
);
const splitActive = ref(true);

function select(template: BuildingTemplate) {
  if (!splitActive.value) {
    openEdit(template);
    return;
  }
  selectedId.value = template.id;
}

function onRowClick(_e: unknown, row: { item: BuildingTemplate }) {
  select(row.item);
}
function onRowDblClick(_e: unknown, row: { item: BuildingTemplate }) {
  openEdit(row.item);
}

function rowProps({ item }: { item: BuildingTemplate }) {
  return item.id === selectedId.value ? { class: 'cp-row-selected' } : {};
}

const rows = computed<PropertyRow[]>(() => {
  const template = selected.value;
  if (!template) return [];
  return [
    { key: 'name', label: t('templates.fields.name'), value: template.name },
    { key: 'description', label: t('templates.fields.description'), value: template.description },
    { key: 'estimatedDurationDays', label: t('templates.fields.estimatedDurationDays'), value: template.estimatedDurationDays, tabular: true },
    { key: 'suggestedProfitMargin', label: t('templates.fields.suggestedProfitMargin'), value: template.suggestedProfitMargin, tabular: true },
    { key: 'isActive', label: t('templates.fields.isActive') },
    { key: 'createdAt', label: t('templates.fields.createdAt') },
  ];
});

async function handleDelete(template: BuildingTemplate) {
  const ok = await confirm({
    title: t('templates.deleteConfirmTitle'),
    message: t('templates.deleteConfirmMessage', { name: template.name }),
    confirmText: t('common.delete'),
    destructive: true,
  });
  if (!ok) return;
  try {
    await templatesApi.remove(template.id);
    toast.success(t('common.deleted'));
    await fetch();
  } catch (e) {
    handle(e);
  }
}
</script>

<template>
  <div class="cp-fill">
    <PageHeader :title="t('nav.templates')" icon="mdi-file-document-multiple-outline" :count="total || null" :hint="t('help.templates')">
      <RoleGate :permissions="WRITE_PERMS" :roles="WRITE_ROLES">
        <v-btn color="primary" size="small" variant="flat" prepend-icon="mdi-plus" to="/templates/new">
          {{ t('templates.new') }}
        </v-btn>
      </RoleGate>
    </PageHeader>

    <WorkspaceSplit storage-key="templates" @update:show-details="splitActive = $event">
      <div class="cp-pane">
      <div class="cp-pane__toolbar flex flex-wrap items-center gap-3">
        <div class="flex-1 min-w-[240px]">
          <SearchBar v-model="searchInput" :placeholder="t('templates.searchPlaceholder')" />
        </div>
        <v-chip-group
          :model-value="filterValue"
          mandatory
          selected-class="bg-primary text-white"
          @update:model-value="onFilterChange"
        >
          <v-chip value="all" size="small">{{ t('templates.filter.all') }}</v-chip>
          <v-chip value="active" size="small">{{ t('templates.filter.active') }}</v-chip>
          <v-chip value="inactive" size="small">{{ t('templates.filter.inactive') }}</v-chip>
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
        :items-per-page-options="[10, 20, 50, 100]"
        item-value="id"
        :row-props="rowProps"
        @update:options="onTableUpdate"
        @click:row="onRowClick"
        @dblclick:row="onRowDblClick"
      >
        <template #[`item.estimatedDurationDays`]="{ item }">
          {{ item.estimatedDurationDays ?? '-' }}
        </template>
        <template #[`item.suggestedProfitMargin`]="{ item }">
          {{ item.suggestedProfitMargin !== null ? `${item.suggestedProfitMargin}%` : '-' }}
        </template>
        <template #[`item.isActive`]="{ item }">
          <v-chip
            size="small"
            variant="tonal"
            :color="item.isActive ? 'success' : undefined"
            :prepend-icon="item.isActive ? 'mdi-check-circle' : 'mdi-circle-off-outline'"
          >
            {{ item.isActive ? t('templates.status.active') : t('templates.status.inactive') }}
          </v-chip>
        </template>
        <template #[`item.createdAt`]="{ item }">
          <DateDisplay :value="item.createdAt" />
        </template>
        <template #[`item.actions`]="{ item }">
          <div class="flex justify-end gap-1" @click.stop>
            <RoleGate :permissions="WRITE_PERMS" :roles="WRITE_ROLES">
              <v-btn
                icon="mdi-pencil"
                size="small"
                variant="text"
                @click="openEdit(item)"
              />
              <v-btn
                icon="mdi-delete-outline"
                size="small"
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
        <DetailsPane :title="selected?.name ?? t('details.title')" icon="mdi-file-document-outline" :selected="Boolean(selected)">
          <PropertyGrid :rows="rows">
            <template #isActive>
              <v-chip v-if="selected" size="x-small" :color="selected.isActive ? 'success' : undefined" variant="tonal">
                {{ selected.isActive ? t('templates.status.active') : t('templates.status.inactive') }}
              </v-chip>
            </template>
            <template #createdAt><DateDisplay :value="selected?.createdAt" /></template>
          </PropertyGrid>
          <template #actions>
            <RoleGate :permissions="WRITE_PERMS" :roles="WRITE_ROLES">
              <v-btn size="x-small" variant="flat" color="primary" prepend-icon="mdi-pencil" @click="selected && openEdit(selected)">
                {{ t('common.edit') }}
              </v-btn>
              <v-btn size="x-small" variant="text" color="error" prepend-icon="mdi-delete-outline" @click="selected && handleDelete(selected)">
                {{ t('common.delete') }}
              </v-btn>
            </RoleGate>
          </template>
        </DetailsPane>
      </template>
    </WorkspaceSplit>
  </div>
</template>
