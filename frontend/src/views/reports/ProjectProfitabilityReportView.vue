<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { t } from '@/i18n';
import { reportsApi } from '@/services/api/reports.api';
import { ApiError } from '@/types/api';
import { ProjectStatus } from '@/types/enums';
import type { ProjectProfitability } from '@/types/report';
import ErrorState from '@/components/shared/ErrorState.vue';
import EmptyState from '@/components/shared/EmptyState.vue';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';
import ProjectStatusBadge from '@/components/features/project/ProjectStatusBadge.vue';
import PageHeader from '@/components/shared/PageHeader.vue';
import DataTable from '@/components/shared/DataTable.vue';

const router = useRouter();

const items = ref<ProjectProfitability[]>([]);
const total = ref(0);
const loading = ref(false);
const error = ref<ApiError | null>(null);

const page = ref(1);
const pageSize = ref(20);
const statusFilter = ref<ProjectStatus | undefined>(undefined);
const sortBy = ref<'createdAt' | 'name' | 'deliveryDate' | 'startDate'>('createdAt');
const sortDir = ref<'asc' | 'desc'>('desc');

async function fetch() {
  loading.value = true;
  error.value = null;
  try {
    const res = await reportsApi.listProjectProfitability({
      page: page.value,
      pageSize: pageSize.value,
      status: statusFilter.value,
      sortBy: sortBy.value,
      sortDir: sortDir.value,
    });
    items.value = res.items;
    total.value = res.total;
  } catch (e) {
    error.value = e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', String(e));
  } finally {
    loading.value = false;
  }
}

watch([page, pageSize, statusFilter, sortBy, sortDir], () => void fetch());
onMounted(fetch);

const columns = computed(() => [
  { key: 'name', title: t('reports.profitability.columns.project'), sortable: true },
  { key: 'customerName', title: t('reports.profitability.columns.customer'), sortable: false },
  { key: 'status', title: t('reports.profitability.columns.status'), sortable: false, width: 130 },
  {
    key: 'contractValue',
    title: t('reports.profitability.columns.contract'),
    sortable: false,
    align: 'end' as const,
  },
  {
    key: 'totalCosts',
    title: t('reports.profitability.columns.costs'),
    sortable: false,
    align: 'end' as const,
  },
  {
    key: 'totalPaid',
    title: t('reports.profitability.columns.paid'),
    sortable: false,
    align: 'end' as const,
  },
  {
    key: 'profit',
    title: t('reports.profitability.columns.profit'),
    sortable: false,
    align: 'end' as const,
  },
]);

const statusOptions = computed<Array<{ value: 'all' | ProjectStatus; title: string }>>(() => [
  { value: 'all', title: t('reports.profitability.filter.all') },
  { value: ProjectStatus.IN_PROGRESS, title: t('projects.status.IN_PROGRESS') },
  { value: ProjectStatus.COMPLETED, title: t('projects.status.COMPLETED') },
  { value: ProjectStatus.PLANNED, title: t('projects.status.PLANNED') },
  { value: ProjectStatus.PAUSED, title: t('projects.status.PAUSED') },
  { value: ProjectStatus.CANCELLED, title: t('projects.status.CANCELLED') },
]);

const statusValue = computed<'all' | ProjectStatus>(() => statusFilter.value ?? 'all');
function onStatusChange(v: 'all' | ProjectStatus) {
  statusFilter.value = v === 'all' ? undefined : v;
  page.value = 1;
}

function onTableUpdate(opts: {
  page: number;
  itemsPerPage: number;
  sortBy: Array<{ key: string; order: 'asc' | 'desc' }>;
}) {
  page.value = opts.page;
  pageSize.value = opts.itemsPerPage;
  const first = opts.sortBy[0];
  if (first && first.key === 'name') {
    sortBy.value = 'name';
    sortDir.value = first.order;
  } else if (opts.sortBy.length === 0) {
    sortBy.value = 'createdAt';
    sortDir.value = 'desc';
  }
}

function openProject(p: ProjectProfitability) {
  void router.push(`/projects/${p.projectId}`);
}

// vue-tsc rejects inline TS annotations inside template event handlers, so
// the row-click handler is hoisted here as a typed wrapper.
function onRowClick(_e: unknown, row: { item: ProjectProfitability }) {
  openProject(row.item);
}

function profitClass(p: string | null) {
  if (p === null) return '';
  const n = Number(p);
  if (n > 0) return 'text-success';
  if (n < 0) return 'text-error';
  return '';
}
</script>

<template>
  <div class="cp-fill">
    <PageHeader :title="t('reports.profitability.title')" back="/reports" />

    <section class="cp-pane">
      <div class="cp-pane__toolbar">
        <v-chip-group
          :model-value="statusValue"
          mandatory
          selected-class="bg-primary text-white"
          @update:model-value="onStatusChange"
        >
          <v-chip
            v-for="opt in statusOptions"
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
        :items-per-page-options="[10, 20, 50, 100]"
        item-value="projectId"
        hover
        @update:options="onTableUpdate"
        @click:row="onRowClick"
      >
        <template #[`item.customerName`]="{ item }">
          {{ item.customerName ?? '-' }}
        </template>
        <template #[`item.status`]="{ item }">
          <ProjectStatusBadge :status="item.status" />
        </template>
        <template #[`item.contractValue`]="{ item }">
          <MoneyDisplay :amount="item.contractValue" />
        </template>
        <template #[`item.totalCosts`]="{ item }">
          <MoneyDisplay :amount="item.totalCosts" />
        </template>
        <template #[`item.totalPaid`]="{ item }">
          <MoneyDisplay :amount="item.totalPaid" />
        </template>
        <template #[`item.profit`]="{ item }">
          <span :class="profitClass(item.profit)" class="font-medium">
            <MoneyDisplay :amount="item.profit" />
          </span>
        </template>
        <template #no-data>
          <EmptyState :title="t('reports.profitability.empty')" icon="mdi-chart-bar" />
        </template>
        </DataTable>
      </div>
    </section>
  </div>
</template>
