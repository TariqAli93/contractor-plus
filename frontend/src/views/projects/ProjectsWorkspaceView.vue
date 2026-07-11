<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { t } from '@/i18n';
import { useProjects } from '@/composables/useProjects';
import { ProjectStatus, RoleName } from '@/types/enums';
import type { ProjectWithContract } from '@/types/project';
import SearchBar from '@/components/shared/SearchBar.vue';
import PageHeader from '@/components/shared/PageHeader.vue';
import ErrorState from '@/components/shared/ErrorState.vue';
import RoleGate from '@/components/shared/RoleGate.vue';
import DateDisplay from '@/components/shared/DateDisplay.vue';
import ProjectStatusBadge from '@/components/features/project/ProjectStatusBadge.vue';
import ProjectProgressBar from '@/components/features/project/ProjectProgressBar.vue';
import ProjectDetailPanel from '@/components/features/project/ProjectDetailPanel.vue';
import WorkspaceSplit from '@/components/shared/workspace/WorkspaceSplit.vue';
import DetailsPane from '@/components/shared/workspace/DetailsPane.vue';
import DataTable from '@/components/shared/DataTable.vue';

const route = useRoute();
const router = useRouter();
const splitActive = ref(true);
const {
  items,
  total,
  loading,
  error,
  page,
  pageSize,
  searchInput,
  status,
  delayed,
  sortBy,
  sortDir,
  fetch,
  setStatusFilter,
  setDelayedFilter,
} = useProjects();

const WRITE_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ENGINEER];
const WRITE_PERMS = ['projects.create', 'projects.update', 'projects.delete'];
const selectedId = ref<string | undefined>(
  typeof route.query.p === 'string' ? route.query.p : undefined,
);
const statusFilter = computed<'all' | ProjectStatus>(() => status.value ?? 'all');
const selectedName = computed(
  () => items.value.find((project) => project.id === selectedId.value)?.name ?? null,
);

function onStatusChange(value: 'all' | ProjectStatus) {
  setStatusFilter(value === 'all' ? undefined : value);
}

function isDelayed(project: ProjectWithContract): boolean {
  if (!project.deliveryDate) return false;
  if (project.status === ProjectStatus.COMPLETED || project.status === ProjectStatus.CANCELLED) return false;
  return new Date(project.deliveryDate).getTime() < Date.now();
}

function select(project: ProjectWithContract) {
  if (!splitActive.value) {
    void router.push(`/projects/${project.id}`);
    return;
  }
  selectedId.value = project.id;
  void router.replace({ query: { ...route.query, p: project.id } });
}

const columns = computed(() => [
  { key: 'name', title: t('projects.fields.name'), sortable: true },
  { key: 'customer', title: t('nav.customers'), sortable: false },
  { key: 'status', title: t('projects.fields.status'), sortable: false, width: 125 },
  { key: 'progressPercentage', title: t('projects.fields.progress'), sortable: false, width: 120, align: 'end' as const },
  { key: 'deliveryDate', title: t('projects.fields.deliveryDate'), sortable: true, width: 145 },
]);

function onTableUpdate(opts: {
  page: number;
  itemsPerPage: number;
  sortBy: Array<{ key: string; order: 'asc' | 'desc' }>;
}) {
  page.value = opts.page;
  pageSize.value = opts.itemsPerPage;
  const first = opts.sortBy[0];
  if (first && (first.key === 'name' || first.key === 'deliveryDate')) {
    sortBy.value = first.key;
    sortDir.value = first.order;
  }
}

function rowProps({ item }: { item: ProjectWithContract }) {
  return item.id === selectedId.value ? { class: 'cp-row-selected' } : {};
}

onMounted(fetch);
</script>

<template>
  <div class="cp-fill">
    <PageHeader :title="t('nav.projects')" :count="total || null" icon="mdi-office-building-outline" :hint="t('help.projects')">
      <RoleGate :permissions="WRITE_PERMS" :roles="WRITE_ROLES">
        <v-btn color="primary" prepend-icon="mdi-plus" to="/projects/new">
          {{ t('projects.new') }}
        </v-btn>
      </RoleGate>
    </PageHeader>

    <WorkspaceSplit
      storage-key="projects"
      :default-width="580"
      :min-master="430"
      :min-details="360"
      @update:show-details="splitActive = $event"
    >
      <div class="cp-pane">
        <div class="cp-pane__toolbar cp-projects__filters">
          <SearchBar v-model="searchInput" :placeholder="t('projects.searchPlaceholder')" />
          <v-chip-group :model-value="statusFilter" mandatory @update:model-value="onStatusChange">
            <v-chip value="all">{{ t('common.empty') }}</v-chip>
            <v-chip :value="ProjectStatus.PLANNED">{{ t('projects.status.PLANNED') }}</v-chip>
            <v-chip :value="ProjectStatus.IN_PROGRESS">{{ t('projects.status.IN_PROGRESS') }}</v-chip>
            <v-chip :value="ProjectStatus.PAUSED">{{ t('projects.status.PAUSED') }}</v-chip>
            <v-chip :value="ProjectStatus.COMPLETED">{{ t('projects.status.COMPLETED') }}</v-chip>
            <v-chip :value="ProjectStatus.CANCELLED">{{ t('projects.status.CANCELLED') }}</v-chip>
          </v-chip-group>
          <v-switch
            :model-value="delayed"
            :label="t('projects.filter.delayedOnly')"
            color="error"
            hide-details
            @update:model-value="(value) => setDelayedFilter(Boolean(value))"
          />
        </div>

        <ErrorState v-if="error" :error="error" class="ma-2" @retry="fetch" />
        <div v-else class="cp-pane__body">
          <DataTable
            :items="items"
            :items-length="total"
            :headers="columns"
            :loading="loading"
            :page="page"
            :items-per-page="pageSize"
            :row-props="rowProps"
            item-value="id"
            @update:options="onTableUpdate"
            @click:row="(_event, row) => select(row.item)"
            @dblclick:row="(_event, row) => router.push(`/projects/${row.item.id}`)"
          >
            <template #[`item.name`]="{ item }"><span class="cp-projects-table__name">{{ item.name }}</span></template>
            <template #[`item.customer`]="{ item }">{{ item.contract?.customer.name ?? '-' }}</template>
            <template #[`item.status`]="{ item }"><ProjectStatusBadge :status="item.status" /></template>
            <template #[`item.progressPercentage`]="{ item }">
              <span class="cp-projects-table__progress">
                <span>{{ item.progressPercentage }}%</span>
                <ProjectProgressBar :value="item.progressPercentage" :show-label="false" :height="3" />
              </span>
            </template>
            <template #[`item.deliveryDate`]="{ item }">
              <span :class="{ 'cp-projects-table__late': isDelayed(item) }"><DateDisplay :value="item.deliveryDate" /></span>
            </template>
            <template #no-data><span class="cp-projects-table__empty">{{ t('common.empty') }}</span></template>
          </DataTable>
        </div>
      </div>

      <template #details>
        <DetailsPane :title="selectedName ?? t('nav.projects')" icon="mdi-office-building-outline" :selected="Boolean(selectedId)">
          <ProjectDetailPanel v-if="selectedId" :project-id="selectedId" @changed="fetch" />
          <template #actions>
            <v-btn size="x-small" variant="text" prepend-icon="mdi-open-in-new" :to="`/projects/${selectedId}`">
              {{ t('projects.openFull') }}
            </v-btn>
          </template>
        </DetailsPane>
      </template>
    </WorkspaceSplit>
  </div>
</template>

<style scoped>
.cp-projects__filters {
  flex-wrap: wrap;
  row-gap: 2px;
}
.cp-projects-table__name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cp-projects-table__progress {
  display: inline-block;
  min-width: 92px;
  font-variant-numeric: tabular-nums;
}
.cp-projects-table__progress :deep(.v-progress-linear) {
  margin-top: 2px;
  border-radius: var(--cp-radius-sm);
}
.cp-projects-table__late {
  color: var(--cp-error);
  font-weight: 600;
}
.cp-projects-table__empty {
  display: block;
  padding: 16px;
  color: var(--cp-text-muted);
}
</style>
