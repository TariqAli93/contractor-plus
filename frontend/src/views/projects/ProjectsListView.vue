<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { t } from '@/i18n';
import { useProjects } from '@/composables/useProjects';
import { useConfirm } from '@/composables/useConfirm';
import { useToast } from '@/composables/useToast';
import { useApiError } from '@/composables/useApiError';
import { projectsApi } from '@/services/api/projects.api';
import { buildProjectColumns } from '@/components/features/project/projectColumns';
import { ProjectStatus, RoleName } from '@/types/enums';
import type { ProjectWithContract } from '@/types/project';
import SearchBar from '@/components/shared/SearchBar.vue';
import ErrorState from '@/components/shared/ErrorState.vue';
import RoleGate from '@/components/shared/RoleGate.vue';
import PageHeader from '@/components/shared/PageHeader.vue';
import DateDisplay from '@/components/shared/DateDisplay.vue';
import DataTable from '@/components/shared/DataTable.vue';
import ProjectStatusBadge from '@/components/features/project/ProjectStatusBadge.vue';
import ProjectProgressBar from '@/components/features/project/ProjectProgressBar.vue';

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

const columns = computed(() => buildProjectColumns(t));

const statusFilter = computed<'all' | ProjectStatus>(() => status.value ?? 'all');

function onStatusChange(v: 'all' | ProjectStatus) {
  setStatusFilter(v === 'all' ? undefined : v);
}

function isDelayed(p: ProjectWithContract): boolean {
  if (!p.deliveryDate) return false;
  if (p.status === ProjectStatus.COMPLETED || p.status === ProjectStatus.CANCELLED) {
    return false;
  }
  return new Date(p.deliveryDate).getTime() < Date.now();
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
  if (
    first &&
    (first.key === 'name' ||
      first.key === 'createdAt' ||
      first.key === 'deliveryDate' ||
      first.key === 'startDate')
  ) {
    sortBy.value = first.key;
    sortDir.value = first.order;
  } else if (opts.sortBy.length === 0) {
    sortBy.value = 'deliveryDate';
    sortDir.value = 'asc';
  }
}

function openProject(project: ProjectWithContract) {
  void router.push(`/projects/${project.id}`);
}

function onRowClick(_e: unknown, row: { item: ProjectWithContract }) {
  openProject(row.item);
}

async function handleDelete(project: ProjectWithContract) {
  const ok = await confirm({
    title: t('projects.deleteConfirmTitle'),
    message: t('projects.deleteConfirmMessage', { name: project.name }),
    confirmText: t('common.delete'),
    destructive: true,
  });
  if (!ok) return;
  try {
    await projectsApi.remove(project.id);
    toast.success(t('common.deleted'));
    await fetch();
  } catch (e) {
    handle(e);
  }
}
</script>

<template>
  <div>
    <PageHeader :title="t('nav.projects')" :count="total || null" icon="mdi-office-building-outline">
      <RoleGate :permissions="WRITE_PERMS" :roles="WRITE_ROLES">
        <v-btn color="primary" prepend-icon="mdi-plus" to="/projects/new">
          {{ t('projects.new') }}
        </v-btn>
      </RoleGate>
    </PageHeader>

    <v-card>
      <v-card-text class="flex flex-wrap items-center gap-3">
        <div class="flex-1 min-w-[240px]">
          <SearchBar v-model="searchInput" :placeholder="t('projects.searchPlaceholder')" />
        </div>
        <v-chip-group
          :model-value="statusFilter"
          mandatory
          selected-class="bg-primary text-white"
          @update:model-value="onStatusChange"
        >
          <v-chip value="all" size="small">{{ t('common.empty') }}</v-chip>
          <v-chip :value="ProjectStatus.PLANNED" size="small">
            {{ t('projects.status.PLANNED') }}
          </v-chip>
          <v-chip :value="ProjectStatus.IN_PROGRESS" size="small">
            {{ t('projects.status.IN_PROGRESS') }}
          </v-chip>
          <v-chip :value="ProjectStatus.PAUSED" size="small">
            {{ t('projects.status.PAUSED') }}
          </v-chip>
          <v-chip :value="ProjectStatus.COMPLETED" size="small">
            {{ t('projects.status.COMPLETED') }}
          </v-chip>
          <v-chip :value="ProjectStatus.CANCELLED" size="small">
            {{ t('projects.status.CANCELLED') }}
          </v-chip>
        </v-chip-group>
        <v-switch
          :model-value="delayed"
          :label="t('projects.filter.delayedOnly')"
          color="error"
          hide-details
          inset
          density="compact"
          @update:model-value="(v) => setDelayedFilter(Boolean(v))"
        />
      </v-card-text>

      <v-divider />

      <ErrorState v-if="error" :error="error" class="my-4" @retry="fetch" />

      <DataTable
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
        @click:row="onRowClick"
      >
        <template #[`item.customer`]="{ item }">
          {{ item.contract?.customer.name ?? '-' }}
        </template>
        <template #[`item.status`]="{ item }">
          <ProjectStatusBadge :status="item.status" />
        </template>
        <template #[`item.progressPercentage`]="{ item }">
          <div class="flex items-center gap-2">
            <ProjectProgressBar :value="item.progressPercentage" class="flex-1" />
            <span class="text-caption text-medium-emphasis">{{ item.progressPercentage }}%</span>
          </div>
        </template>
        <template #[`item.deliveryDate`]="{ item }">
          <span :class="{ 'text-error font-medium': isDelayed(item) }">
            <v-icon v-if="isDelayed(item)" icon="mdi-clock-alert-outline" size="small" class="me-1" />
            <DateDisplay :value="item.deliveryDate" />
          </span>
        </template>
        <template #[`item.actions`]="{ item }">
          <div class="flex justify-end gap-1" @click.stop>
            <RoleGate :permissions="WRITE_PERMS" :roles="WRITE_ROLES">
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
    </v-card>
  </div>
</template>
