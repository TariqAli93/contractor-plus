<script setup lang="ts">
import { computed } from 'vue';
import { t } from '@/i18n';
import type { DelayedProjectRow as DelayedProjectRowType } from '@/types/dashboard';
import DashboardSection from './DashboardSection.vue';
import DelayedProjectRow from './DelayedProjectRow.vue';
import EmptyState from '@/components/shared/EmptyState.vue';

const props = defineProps<{
  projects: DelayedProjectRowType[];
  loading: boolean;
}>();

const top = computed(() => props.projects.slice(0, 5));
</script>

<template>
  <DashboardSection :title="t('dashboard.delayed.title')" icon="mdi-clock-alert-outline">
    <template #action>
      <v-btn
        v-if="projects.length > 0"
        variant="text"
        size="small"
        append-icon="mdi-arrow-left"
        to="/projects?delayed=true"
      >
        {{ t('dashboard.viewAll') }}
      </v-btn>
    </template>

    <div v-if="loading && projects.length === 0" class="p-2">
      <v-skeleton-loader
        v-for="i in 3"
        :key="i"
        type="list-item-avatar-three-line"
        class="px-2"
      />
    </div>

    <div v-else-if="top.length > 0">
      <DelayedProjectRow v-for="p in top" :key="p.projectId" :row="p" />
    </div>

    <EmptyState
      v-else
      :title="t('dashboard.delayed.empty')"
      icon="mdi-check-circle-outline"
      compact
    />
  </DashboardSection>
</template>
