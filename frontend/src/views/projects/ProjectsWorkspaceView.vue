<script setup lang="ts">
// Master-detail projects workspace (roadmap Phase 2, "single screen"): a
// compact, searchable project list on the start side; the selected project's
// full detail panel on the other — no page hop. On narrow screens it falls
// back to navigating to the full-page detail. Selection is mirrored to ?p= so
// a refresh / shared link reopens the same project.
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDisplay } from 'vuetify';
import { t } from '@/i18n';
import { useProjects } from '@/composables/useProjects';
import { ProjectStatus, RoleName } from '@/types/enums';
import type { ProjectWithContract } from '@/types/project';
import SearchBar from '@/components/shared/SearchBar.vue';
import ErrorState from '@/components/shared/ErrorState.vue';
import RoleGate from '@/components/shared/RoleGate.vue';
import DateDisplay from '@/components/shared/DateDisplay.vue';
import ProjectStatusBadge from '@/components/features/project/ProjectStatusBadge.vue';
import ProjectProgressBar from '@/components/features/project/ProjectProgressBar.vue';
import ProjectDetailPanel from '@/components/features/project/ProjectDetailPanel.vue';

const route = useRoute();
const router = useRouter();
// Match the Tailwind `lg:` (1024px) split layout below, so the click behaviour
// (inline-select vs navigate) flips at the same width the panes appear.
const { width } = useDisplay();
const isSplit = computed(() => width.value >= 1024);

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
function onStatusChange(v: 'all' | ProjectStatus) {
  setStatusFilter(v === 'all' ? undefined : v);
}

function isDelayed(p: ProjectWithContract): boolean {
  if (!p.deliveryDate) return false;
  if (p.status === ProjectStatus.COMPLETED || p.status === ProjectStatus.CANCELLED) return false;
  return new Date(p.deliveryDate).getTime() < Date.now();
}

function select(p: ProjectWithContract) {
  if (isSplit.value) {
    selectedId.value = p.id;
    void router.replace({ query: { ...route.query, p: p.id } });
  } else {
    void router.push(`/projects/${p.id}`);
  }
}

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));

onMounted(fetch);
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-4 gap-2 flex-wrap">
      <h1 class="text-h5">{{ t('nav.projects') }}</h1>
      <RoleGate :permissions="WRITE_PERMS" :roles="WRITE_ROLES">
        <v-btn color="primary" prepend-icon="mdi-plus" to="/projects/new">
          {{ t('projects.new') }}
        </v-btn>
      </RoleGate>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-12 gap-4">
      <!-- Master: searchable list -->
      <div class="lg:col-span-4">
        <v-card>
          <v-card-text class="pb-2">
            <SearchBar v-model="searchInput" :placeholder="t('projects.searchPlaceholder')" />
            <v-chip-group
              :model-value="statusFilter"
              mandatory
              selected-class="bg-primary text-white"
              class="mt-1"
              @update:model-value="onStatusChange"
            >
              <v-chip value="all" size="x-small">{{ t('common.empty') }}</v-chip>
              <v-chip :value="ProjectStatus.PLANNED" size="x-small">{{ t('projects.status.PLANNED') }}</v-chip>
              <v-chip :value="ProjectStatus.IN_PROGRESS" size="x-small">{{ t('projects.status.IN_PROGRESS') }}</v-chip>
              <v-chip :value="ProjectStatus.PAUSED" size="x-small">{{ t('projects.status.PAUSED') }}</v-chip>
              <v-chip :value="ProjectStatus.COMPLETED" size="x-small">{{ t('projects.status.COMPLETED') }}</v-chip>
              <v-chip :value="ProjectStatus.CANCELLED" size="x-small">{{ t('projects.status.CANCELLED') }}</v-chip>
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
          <template v-else>
            <v-progress-linear v-if="loading" indeterminate />
            <div class="cp-master-list">
              <button
                v-for="p in items"
                :key="p.id"
                type="button"
                class="cp-master-item"
                :class="{ 'is-active': p.id === selectedId }"
                @click="select(p)"
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="cp-master-name">{{ p.name }}</span>
                  <ProjectStatusBadge :status="p.status" />
                </div>
                <div class="text-caption text-medium-emphasis">{{ p.contract?.customer.name ?? '—' }}</div>
                <div class="flex items-center gap-2 mt-1">
                  <ProjectProgressBar :value="p.progressPercentage" class="flex-1" />
                  <span class="text-caption" :class="{ 'text-error font-medium': isDelayed(p) }">
                    <DateDisplay :value="p.deliveryDate" />
                  </span>
                </div>
              </button>
              <div v-if="!loading && items.length === 0" class="cp-master-empty">
                {{ t('common.empty') }}
              </div>
            </div>

            <template v-if="pageCount > 1">
              <v-divider />
              <div class="pa-2 d-flex justify-center">
                <v-pagination v-model="page" :length="pageCount" :total-visible="4" density="comfortable" />
              </div>
            </template>
          </template>
        </v-card>
      </div>

      <!-- Detail: the selected project, or a hint -->
      <div class="lg:col-span-8">
        <template v-if="selectedId">
          <div class="d-flex justify-end mb-2">
            <v-btn
              variant="text"
              size="small"
              prepend-icon="mdi-open-in-new"
              :to="`/projects/${selectedId}`"
            >
              {{ t('projects.openFull') }}
            </v-btn>
          </div>
          <ProjectDetailPanel :project-id="selectedId" @changed="fetch" />
        </template>
        <v-card v-else class="cp-detail-empty">
          <div class="text-center text-medium-emphasis pa-12">
            <v-icon size="48" class="mb-3 d-block mx-auto">mdi-gesture-tap</v-icon>
            {{ t('projects.workspace.selectHint') }}
          </div>
        </v-card>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cp-master-list {
  max-height: calc(100vh - 340px);
  min-height: 200px;
  overflow-y: auto;
}
.cp-master-item {
  display: block;
  width: 100%;
  text-align: start;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(var(--v-border-color), 0.4);
  cursor: pointer;
}
.cp-master-item:hover {
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.cp-master-item.is-active {
  background: rgba(var(--v-theme-primary), 0.1);
  border-inline-start: 3px solid rgb(var(--v-theme-primary));
}
.cp-master-name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cp-master-empty {
  padding: 36px;
  text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.cp-detail-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 320px;
}
</style>
