<script setup lang="ts">
// Costs workspace: a dense grid on one side, the selected cost's property sheet
// on the other. Single click selects (the pane follows), double click opens the
// full record - the Explorer/Access convention. On a window too narrow for two
// panes the single click navigates instead.
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { t } from '@/i18n';
import { useCosts } from '@/composables/useCosts';
import { useConfirm } from '@/composables/useConfirm';
import { useToast } from '@/composables/useToast';
import { useApiError } from '@/composables/useApiError';
import { costsApi } from '@/services/api/costs.api';
import { projectsApi } from '@/services/api/projects.api';
import { buildCostColumns } from '@/components/features/cost/costColumns';
import { CostCategory, RoleName } from '@/types/enums';
import type { CostWithMaterial } from '@/types/cost';
import type { ProjectWithContract } from '@/types/project';
import SearchBar from '@/components/shared/SearchBar.vue';
import ErrorState from '@/components/shared/ErrorState.vue';
import RoleGate from '@/components/shared/RoleGate.vue';
import PageHeader from '@/components/shared/PageHeader.vue';
import DateDisplay from '@/components/shared/DateDisplay.vue';
import DataTable from '@/components/shared/DataTable.vue';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';
import CostCategoryBadge from '@/components/features/cost/CostCategoryBadge.vue';
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
  category,
  sortBy,
  sortDir,
  fetch,
  setProjectFilter,
  setCategoryFilter,
  setDateRange,
} = useCosts();

const WRITE_ROLES: RoleName[] = [
  RoleName.OWNER,
  RoleName.ADMIN,
  RoleName.ACCOUNTANT,
  RoleName.ENGINEER,
];
const WRITE_PERMS = ['costs.create', 'costs.update', 'costs.delete'];

const columns = computed(() => buildCostColumns(t));

// Project picker for the filter bar. Loaded once.
const projects = ref<ProjectWithContract[]>([]);
async function loadProjects() {
  try {
    const res = await projectsApi.list({
      page: 1,
      pageSize: 100,
      sortBy: 'name',
      sortDir: 'asc',
    });
    projects.value = res.items;
  } catch {
    /* picker failure is non-fatal - user can still see all costs */
  }
}

const projectOptions = computed(() => [
  { value: undefined as string | undefined, title: t('costs.filter.allProjects') },
  ...projects.value.map((p) => ({ value: p.id, title: p.name })),
]);

const categoryOptions = computed<Array<{ value: 'all' | CostCategory; title: string }>>(() => [
  { value: 'all', title: t('costs.filter.allCategories') },
  { value: CostCategory.MATERIAL, title: t('costs.category.MATERIAL') },
  { value: CostCategory.LABOR, title: t('costs.category.LABOR') },
  { value: CostCategory.MACHINERY, title: t('costs.category.MACHINERY') },
  { value: CostCategory.TRANSPORT, title: t('costs.category.TRANSPORT') },
  { value: CostCategory.MISC, title: t('costs.category.MISC') },
]);

const categoryFilter = computed<'all' | CostCategory>(() => category.value ?? 'all');
function onCategoryChange(v: 'all' | CostCategory) {
  setCategoryFilter(v === 'all' ? undefined : v);
}

const localDateFrom = ref<string | undefined>(undefined);
const localDateTo = ref<string | undefined>(undefined);
watch([localDateFrom, localDateTo], ([from, to]) => {
  setDateRange(from, to);
});

// Selection is mirrored to ?id= so a refresh reopens the same record.
const selectedId = ref<string | null>(
  typeof route.query.id === 'string' ? route.query.id : null,
);
const selected = computed<CostWithMaterial | null>(
  () => items.value.find((c) => c.id === selectedId.value) ?? null,
);

// If the user navigated here with ?projectId=..., pre-bind the filter so the
// list opens already scoped to that project.
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
  if (first && (first.key === 'date' || first.key === 'totalAmount')) {
    sortBy.value = first.key;
    sortDir.value = first.order;
  } else if (opts.sortBy.length === 0) {
    sortBy.value = 'date';
    sortDir.value = 'desc';
  }
}

function openEdit(cost: CostWithMaterial) {
  void router.push(`/costs/${cost.id}`);
}

function newCost() {
  const qs = projectId.value ? `?projectId=${projectId.value}` : '';
  void router.push(`/costs/new${qs}`);
}

// True when the details pane is actually on screen; WorkspaceSplit owns the rule.
const splitActive = ref(true);

function select(cost: CostWithMaterial) {
  if (!splitActive.value) {
    openEdit(cost);
    return;
  }
  selectedId.value = cost.id;
  void router.replace({ query: { ...route.query, id: cost.id } });
}

function onRowClick(_e: unknown, row: { item: CostWithMaterial }) {
  select(row.item);
}
function onRowDblClick(_e: unknown, row: { item: CostWithMaterial }) {
  openEdit(row.item);
}

/** Mark the selected row so the grid and the pane agree at a glance. */
function rowProps({ item }: { item: CostWithMaterial }) {
  return item.id === selectedId.value ? { class: 'cp-row-selected' } : {};
}

const rows = computed<PropertyRow[]>(() => {
  const c = selected.value;
  if (!c) return [];
  return [
    { key: 'date', label: t('costs.fields.date'), tabular: true },
    { key: 'category', label: t('costs.fields.category') },
    { key: 'description', label: t('costs.fields.description'), value: c.description },
    { key: 'material', label: t('costs.fields.material') },
    { key: 'quantity', label: t('costs.fields.quantity'), value: c.quantity, tabular: true },
    { key: 'unit', label: t('costs.fields.unit'), value: c.unit },
    { key: 'unitPrice', label: t('costs.fields.unitPrice'), tabular: true },
    { key: 'totalAmount', label: t('costs.fields.totalAmount'), tabular: true },
    { key: 'notes', label: t('costs.fields.notes'), value: c.notes },
  ];
});

async function handleDelete(cost: CostWithMaterial) {
  const ok = await confirm({
    title: t('costs.deleteConfirmTitle'),
    message: t('costs.deleteConfirmMessage', { description: cost.description }),
    confirmText: t('common.delete'),
    destructive: true,
  });
  if (!ok) return;
  try {
    await costsApi.remove(cost.id);
    toast.success(t('common.deleted'));
    if (selectedId.value === cost.id) selectedId.value = null;
    await fetch();
  } catch (e) {
    handle(e);
  }
}
</script>

<template>
  <div class="cp-fill">
    <PageHeader :title="t('nav.costs')" :count="total || null" icon="mdi-cash-minus" :hint="t('help.costs')">
      <RoleGate :permissions="WRITE_PERMS" :roles="WRITE_ROLES">
        <v-btn color="primary" size="small" variant="flat" prepend-icon="mdi-plus" @click="newCost">
          {{ t('costs.new') }}
        </v-btn>
      </RoleGate>
    </PageHeader>

    <WorkspaceSplit storage-key="costs" @update:show-details="splitActive = $event">
      <div class="cp-pane">
        <div class="cp-pane__toolbar">
          <div class="flex flex-wrap items-center gap-3">
            <div class="flex-1 min-w-[240px]">
              <SearchBar v-model="searchInput" :placeholder="t('costs.searchPlaceholder')" />
            </div>
            <v-select
              :model-value="projectId"
              :items="projectOptions"
              :label="t('costs.filter.project')"
              density="compact"
              hide-details
              style="min-width: 220px"
              clearable
              @update:model-value="setProjectFilter"
            />
            <v-text-field
              v-model="localDateFrom"
              :label="t('costs.filter.dateFrom')"
              type="date"
              density="compact"
              hide-details
              style="max-width: 170px"
            />
            <v-text-field
              v-model="localDateTo"
              :label="t('costs.filter.dateTo')"
              type="date"
              density="compact"
              hide-details
              style="max-width: 170px"
            />
          </div>
          <v-chip-group
            :model-value="categoryFilter"
            mandatory
            selected-class="bg-primary text-white"
            @update:model-value="onCategoryChange"
          >
            <v-chip
              v-for="opt in categoryOptions"
              :key="opt.value"
              :value="opt.value"
              size="small"
            >
              {{ opt.title }}
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
            <template #[`item.date`]="{ item }">
              <DateDisplay :value="item.date" />
            </template>
            <template #[`item.category`]="{ item }">
              <CostCategoryBadge :category="item.category" />
            </template>
            <template #[`item.description`]="{ item }">
              <div class="truncate" :title="item.description">{{ item.description }}</div>
            </template>
            <template #[`item.material`]="{ item }">
              <span v-if="item.material" class="text-body-2">
                {{ item.material.name }}
                <span class="text-medium-emphasis text-caption">({{ item.material.unit }})</span>
              </span>
              <span v-else class="text-medium-emphasis">-</span>
            </template>
            <template #[`item.totalAmount`]="{ item }">
              <span class="font-medium">
                <MoneyDisplay :amount="item.totalAmount" />
              </span>
            </template>
            <template #[`item.actions`]="{ item }">
              <div class="cp-row-actions" @click.stop>
                <RoleGate :permissions="WRITE_PERMS" :roles="WRITE_ROLES">
                  <v-btn icon="mdi-pencil" size="x-small" variant="text" @click="openEdit(item)" />
                  <v-btn
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
          :title="selected?.description ?? t('details.title')"
          icon="mdi-cash-minus"
          :selected="Boolean(selected)"
        >
          <PropertyGrid :rows="rows">
            <template #date>
              <DateDisplay :value="selected?.date" />
            </template>
            <template #category>
              <CostCategoryBadge v-if="selected" :category="selected.category" />
            </template>
            <template #material>
              <span v-if="selected?.material">
                {{ selected.material.name }}
                <span class="text-medium-emphasis text-caption">({{ selected.material.unit }})</span>
              </span>
              <span v-else>-</span>
            </template>
            <template #unitPrice>
              <MoneyDisplay v-if="selected?.unitPrice" :amount="selected.unitPrice" />
              <span v-else>-</span>
            </template>
            <template #totalAmount>
              <MoneyDisplay :amount="selected?.totalAmount" />
            </template>
          </PropertyGrid>

          <template #actions>
            <RoleGate :permissions="WRITE_PERMS" :roles="WRITE_ROLES">
              <v-btn
                size="x-small"
                variant="flat"
                color="primary"
                prepend-icon="mdi-pencil"
                @click="selected && openEdit(selected)"
              >
                {{ t('common.edit') }}
              </v-btn>
              <v-btn
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
  </div>
</template>

<style scoped>
.cp-row-actions {
  display: flex;
  justify-content: flex-end;
  gap: 2px;
}
</style>
