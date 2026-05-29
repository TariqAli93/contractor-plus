<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import type { DelayedProjectRow } from '@/types/dashboard';
import ProjectStatusBadge from '@/components/features/project/ProjectStatusBadge.vue';
import ProjectProgressBar from '@/components/features/project/ProjectProgressBar.vue';
import DateDisplay from '@/components/shared/DateDisplay.vue';

const props = defineProps<{ row: DelayedProjectRow }>();
const router = useRouter();
const { t } = useI18n();

function open() {
  void router.push(`/projects/${props.row.projectId}`);
}
</script>

<template>
  <button type="button" class="cp-row-button" @click="open">
    <div class="flex items-center gap-3 flex-wrap">
      <span class="cp-icon-tile cp-icon-tile--warning">
        <v-icon icon="mdi-clock-alert-outline" size="18" />
      </span>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 mb-1">
          <span class="font-medium truncate">{{ row.name }}</span>
          <ProjectStatusBadge :status="row.status" size="x-small" />
        </div>
        <div
          class="text-caption text-medium-emphasis flex items-center gap-x-2 flex-wrap"
        >
          <span v-if="row.customerName" class="truncate">{{ row.customerName }}</span>
          <span v-if="row.contractNumber" aria-hidden="true">·</span>
          <span v-if="row.contractNumber" class="truncate">{{ row.contractNumber }}</span>
          <span aria-hidden="true">·</span>
          <span class="inline-flex items-center gap-1">
            <v-icon icon="mdi-calendar-arrow-right" size="14" />
            <DateDisplay :value="row.deliveryDate" />
          </span>
        </div>
      </div>
      <div class="flex flex-col items-end gap-1.5 min-w-[140px]">
        <v-chip size="x-small" color="error" variant="tonal" prepend-icon="mdi-clock-alert-outline">
          {{ t('dashboard.delayed.daysLate', { days: row.daysDelayed }) }}
        </v-chip>
        <div class="w-full flex items-center gap-2">
          <ProjectProgressBar :value="row.progressPercentage" :height="6" class="flex-1" />
          <span class="text-caption text-medium-emphasis tabular-nums">
            {{ row.progressPercentage }}%
          </span>
        </div>
      </div>
    </div>
  </button>
</template>
