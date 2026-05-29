<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { ProjectStatus } from '@/types/enums';
import type { ProjectWithContract } from '@/types/project';
import ProjectProgressBar from './ProjectProgressBar.vue';

const props = defineProps<{ project: ProjectWithContract }>();
const { t } = useI18n();

const pct = computed(() => Number(props.project.progressPercentage));

const color = computed(() => {
  if (props.project.status === ProjectStatus.COMPLETED) return 'success';
  if (props.project.status === ProjectStatus.CANCELLED) return 'error';
  if (props.project.status === ProjectStatus.PAUSED) return 'warning';
  return 'primary';
});

const timeline = computed(() => {
  if (!props.project.startDate || !props.project.deliveryDate) return null;
  const start = new Date(props.project.startDate).getTime();
  const end = new Date(props.project.deliveryDate).getTime();
  const now = Date.now();
  const totalDays = Math.max(1, Math.round((end - start) / (24 * 60 * 60 * 1000)));
  const elapsedDays = Math.max(0, Math.round((now - start) / (24 * 60 * 60 * 1000)));
  const remainingDays = Math.round((end - now) / (24 * 60 * 60 * 1000));
  return { totalDays, elapsedDays, remainingDays };
});
</script>

<template>
  <v-card variant="outlined">
    <v-card-text>
      <div class="flex items-center justify-between mb-2">
        <div class="text-medium-emphasis text-sm">{{ t('projects.progress.title') }}</div>
        <div class="text-h5 font-medium">{{ pct }}%</div>
      </div>
      <ProjectProgressBar :value="pct" :color="color" :height="14" />

      <div v-if="timeline" class="grid grid-cols-3 gap-4 mt-4 text-sm">
        <div>
          <div class="text-medium-emphasis text-xs">{{ t('projects.progress.totalDays') }}</div>
          <div>{{ timeline.totalDays }}</div>
        </div>
        <div>
          <div class="text-medium-emphasis text-xs">{{ t('projects.progress.elapsedDays') }}</div>
          <div>{{ timeline.elapsedDays }}</div>
        </div>
        <div>
          <div class="text-medium-emphasis text-xs">{{ t('projects.progress.remainingDays') }}</div>
          <div :class="{ 'text-error font-medium': timeline.remainingDays < 0 }">
            {{ timeline.remainingDays }}
          </div>
        </div>
      </div>
    </v-card-text>
  </v-card>
</template>
