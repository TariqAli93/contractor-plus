<script setup lang="ts">
import { useRouter } from 'vue-router';
import type { DashboardRecentProject } from '@/types/dashboard';
import ProjectStatusBadge from '@/components/features/project/ProjectStatusBadge.vue';
import ProjectProgressBar from '@/components/features/project/ProjectProgressBar.vue';
import DateDisplay from '@/components/shared/DateDisplay.vue';

const props = defineProps<{ project: DashboardRecentProject }>();
const router = useRouter();

function open() {
  void router.push(`/projects/${props.project.id}`);
}
</script>

<template>
  <button type="button" class="cp-row-button" @click="open">
    <div class="flex items-center gap-3">
      <span class="cp-icon-tile cp-icon-tile--neutral">
        <v-icon icon="mdi-office-building-outline" size="18" />
      </span>
      <div class="min-w-0 flex-1">
        <div class="flex items-center justify-between gap-2 mb-1">
          <span class="font-medium truncate">{{ project.name }}</span>
          <ProjectStatusBadge :status="project.status" size="x-small" />
        </div>
        <div
          class="text-caption text-medium-emphasis flex items-center gap-x-2 flex-wrap mb-1.5"
        >
          <span v-if="project.contract?.customer.name" class="truncate">
            {{ project.contract.customer.name }}
          </span>
          <span v-if="project.contract?.contractNumber" aria-hidden="true">·</span>
          <span v-if="project.contract?.contractNumber" class="truncate">
            {{ project.contract.contractNumber }}
          </span>
          <span v-if="project.createdAt" aria-hidden="true">·</span>
          <DateDisplay v-if="project.createdAt" :value="project.createdAt" />
        </div>
        <div class="flex items-center gap-2">
          <ProjectProgressBar :value="project.progressPercentage" :height="4" class="flex-1" />
          <span class="text-caption text-medium-emphasis tabular-nums">
            {{ project.progressPercentage }}%
          </span>
        </div>
      </div>
    </div>
  </button>
</template>
