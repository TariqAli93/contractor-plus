<script setup lang="ts">
import { computed } from 'vue';
import { t } from '@/i18n';
import { useRouter } from 'vue-router';
import { ProjectStatus } from '@/types/enums';
import type { ProjectWithContract } from '@/types/project';
import DateDisplay from '@/components/shared/DateDisplay.vue';

const props = defineProps<{ project: ProjectWithContract }>();
const router = useRouter();

const isDelayed = computed(() => {
  if (!props.project.deliveryDate) return false;
  if (
    props.project.status === ProjectStatus.COMPLETED ||
    props.project.status === ProjectStatus.CANCELLED
  )
    return false;
  return new Date(props.project.deliveryDate).getTime() < Date.now();
});

const daysDelayed = computed(() => {
  if (!isDelayed.value || !props.project.deliveryDate) return 0;
  const ms = Date.now() - new Date(props.project.deliveryDate).getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
});
</script>

<template>
  <!-- Single root so the parent's `class` (e.g. mb-4) inherits cleanly. -->
  <div>
    <v-alert
      v-if="isDelayed"
      type="error"
      variant="tonal"
      icon="mdi-clock-alert-outline"
      class="mb-4"
    >
      {{ t('projects.delayedBy', { days: daysDelayed }) }}
    </v-alert>

    <v-card variant="outlined">
    <v-card-text class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div>
        <div class="text-medium-emphasis text-xs">{{ t('projects.fields.name') }}</div>
        <div class="text-h6">{{ project.name }}</div>
      </div>
      <div>
        <div class="text-medium-emphasis text-xs">{{ t('projects.fields.customer') }}</div>
        <div class="text-subtitle-1">
          {{ project.contract?.customer.name ?? '—' }}
        </div>
      </div>
      <div>
        <div class="text-medium-emphasis text-xs">{{ t('projects.fields.contract') }}</div>
        <button
          v-if="project.contract"
          class="text-subtitle-1 text-start text-primary"
          @click="router.push(`/contracts/${project.contract!.id}`)"
        >
          {{ project.contract.contractNumber }}
        </button>
        <div v-else class="text-subtitle-1 text-medium-emphasis">—</div>
      </div>
      <div>
        <div class="text-medium-emphasis text-xs">{{ t('projects.fields.startDate') }}</div>
        <DateDisplay :value="project.startDate" />
      </div>
      <div>
        <div class="text-medium-emphasis text-xs">{{ t('projects.fields.deliveryDate') }}</div>
        <span :class="{ 'text-error font-medium': isDelayed }">
          <DateDisplay :value="project.deliveryDate" />
        </span>
      </div>
      <div>
        <div class="text-medium-emphasis text-xs">{{ t('projects.fields.createdAt') }}</div>
        <DateDisplay :value="project.createdAt" />
      </div>
      </v-card-text>
    </v-card>
  </div>
</template>
