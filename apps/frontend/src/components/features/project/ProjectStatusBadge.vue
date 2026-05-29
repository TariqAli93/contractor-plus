<script setup lang="ts">
import { computed } from 'vue';
import { t } from '@/i18n';
import { ProjectStatus } from '@/types/enums';

const props = defineProps<{
  status: ProjectStatus;
  size?: 'x-small' | 'small' | 'default' | 'large';
}>();

const color = computed(() => {
  switch (props.status) {
    case ProjectStatus.PLANNED:
      return 'info';
    case ProjectStatus.IN_PROGRESS:
      return 'primary';
    case ProjectStatus.PAUSED:
      return 'warning';
    case ProjectStatus.COMPLETED:
      return 'success';
    case ProjectStatus.CANCELLED:
      return 'error';
    default:
      return undefined;
  }
});

const icon = computed(() => {
  switch (props.status) {
    case ProjectStatus.PLANNED:
      return 'mdi-clipboard-text-clock-outline';
    case ProjectStatus.IN_PROGRESS:
      return 'mdi-progress-wrench';
    case ProjectStatus.PAUSED:
      return 'mdi-pause-circle-outline';
    case ProjectStatus.COMPLETED:
      return 'mdi-check-circle-outline';
    case ProjectStatus.CANCELLED:
      return 'mdi-cancel';
    default:
      return undefined;
  }
});
</script>

<template>
  <v-chip :color="color" :prepend-icon="icon" :size="size ?? 'small'" variant="tonal">
    {{ t(`projects.status.${status}`) }}
  </v-chip>
</template>
