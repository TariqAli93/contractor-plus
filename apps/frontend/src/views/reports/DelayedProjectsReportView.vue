<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { t } from '@/i18n';
import { reportsApi } from '@/services/api/reports.api';
import { ApiError } from '@/types/api';
import type { DelayedProjectRow } from '@/types/report';
import ErrorState from '@/components/shared/ErrorState.vue';
import EmptyState from '@/components/shared/EmptyState.vue';
import DateDisplay from '@/components/shared/DateDisplay.vue';
import ProjectStatusBadge from '@/components/features/project/ProjectStatusBadge.vue';

const rows = ref<DelayedProjectRow[]>([]);
const loading = ref(false);
const error = ref<ApiError | null>(null);

async function fetch() {
  loading.value = true;
  error.value = null;
  try {
    rows.value = await reportsApi.delayedProjects();
  } catch (e) {
    error.value = e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', String(e));
  } finally {
    loading.value = false;
  }
}

onMounted(fetch);

const headers = computed(() => [
  { key: 'name', title: t('reports.delayed.columns.project') },
  { key: 'customerName', title: t('reports.delayed.columns.customer') },
  { key: 'status', title: t('reports.delayed.columns.status'), width: 130 },
  { key: 'deliveryDate', title: t('reports.delayed.columns.deliveryDate'), width: 150 },
  { key: 'daysDelayed', title: t('reports.delayed.columns.daysDelayed'), width: 130 },
  { key: 'progressPercentage', title: t('reports.delayed.columns.progress'), width: 130 },
]);
</script>

<template>
  <div>
    <div class="flex items-center gap-2 mb-4">
      <v-btn icon="mdi-arrow-right" variant="text" to="/reports" />
      <h1 class="text-h5">{{ t('reports.delayed.title') }}</h1>
      <v-spacer />
      <v-btn variant="text" prepend-icon="mdi-refresh" :loading="loading" @click="fetch">
        {{ t('common.retry') }}
      </v-btn>
    </div>

    <ErrorState v-if="error" :error="error" @retry="fetch" />

    <v-card v-else>
      <v-data-table
        :items="rows"
        :headers="headers"
        :loading="loading"
        item-value="projectId"
        hover
      >
        <template #[`item.name`]="{ item }">
          <RouterLink :to="`/projects/${item.projectId}`" class="text-primary">
            {{ item.name }}
          </RouterLink>
          <div v-if="item.contractNumber" class="text-caption text-medium-emphasis">
            {{ item.contractNumber }}
          </div>
        </template>
        <template #[`item.customerName`]="{ item }">
          {{ item.customerName ?? '—' }}
        </template>
        <template #[`item.status`]="{ item }">
          <ProjectStatusBadge :status="item.status" />
        </template>
        <template #[`item.deliveryDate`]="{ item }">
          <DateDisplay :value="item.deliveryDate" />
        </template>
        <template #[`item.daysDelayed`]="{ item }">
          <span class="text-error font-medium">{{ item.daysDelayed }}d</span>
        </template>
        <template #[`item.progressPercentage`]="{ item }">
          {{ item.progressPercentage }}%
        </template>
        <template #no-data>
          <EmptyState
            :title="t('reports.delayed.empty')"
            icon="mdi-check-circle-outline"
          />
        </template>
      </v-data-table>
    </v-card>
  </div>
</template>
