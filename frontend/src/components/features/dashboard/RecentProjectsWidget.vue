<script setup lang="ts">
import { computed } from 'vue';
import { t } from '@/i18n';
import type { DashboardRecentProject } from '@/types/dashboard';
import DashboardSection from './DashboardSection.vue';
import RecentProjectCard from './RecentProjectCard.vue';
import EmptyState from '@/components/shared/EmptyState.vue';

const props = defineProps<{
  projects: DashboardRecentProject[];
  loading: boolean;
}>();

const top = computed(() => props.projects.slice(0, 5));
</script>

<template>
  <DashboardSection :title="t('dashboard.recent.projects')" icon="mdi-clipboard-list-outline">
    <template #action>
      <v-btn variant="text" size="small" append-icon="mdi-arrow-left" to="/projects">
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
      <RecentProjectCard v-for="p in top" :key="p.id" :project="p" />
    </div>

    <EmptyState
      v-else
      :title="t('dashboard.recent.empty')"
      icon="mdi-clipboard-outline"
      compact
    />
  </DashboardSection>
</template>
