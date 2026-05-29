<script setup lang="ts">
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
import DateDisplay from '@/components/shared/DateDisplay.vue';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';
import CostCategoryBadge from '@/components/features/cost/CostCategoryBadge.vue';

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
  dateFrom,
  dateTo,
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
    /* picker failure is non-fatal — user can still see all costs */
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
    await fetch();
  } catch (e) {
    handle(e);
  }
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-4 gap-2 flex-wrap">
      <h1 class="text-h5">{{ t('nav.costs') }}</h1>
      <RoleGate :roles="WRITE_ROLES">
        <v-btn color="primary" prepend-icon="mdi-plus" @click="newCost">
          {{ t('costs.new') }}
        </v-btn>
      </RoleGate>
    </div>

    <v-card>
      <v-card-text class="space-y-3">
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
      </v-card-text>

      <v-divider />

      <ErrorState v-if="error" :error="error" class="my-4" @retry="fetch" />

      <v-data-table-server
        v-else
        :items="items"
        :items-length="total"
        :headers="columns"
        :loading="loading"
        :page="page"
        :items-per-page="pageSize"
        :items-per-page-options="[10, 20, 50, 100]"
        item-value="id"
        hover
        @update:options="onTableUpdate"
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
          <span v-else class="text-medium-emphasis">—</span>
        </template>
        <template #[`item.totalAmount`]="{ item }">
          <span class="font-medium">
            <MoneyDisplay :amount="item.totalAmount" />
          </span>
        </template>
        <template #[`item.actions`]="{ item }">
          <div class="flex justify-end gap-1" @click.stop>
            <RoleGate :roles="WRITE_ROLES">
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
      </v-data-table-server>
    </v-card>
  </div>
</template>
