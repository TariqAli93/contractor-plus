<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { projectsApi } from '@/services/api/projects.api';
import { useApiError } from '@/composables/useApiError';
import { useToast } from '@/composables/useToast';
import { useCan } from '@/composables/useCan';
import { ProjectStatus, RoleName } from '@/types/enums';
import type { ProjectWithContract } from '@/types/project';
import ProjectProgressBar from './ProjectProgressBar.vue';
import RoleGate from '@/components/shared/RoleGate.vue';

const props = defineProps<{ project: ProjectWithContract }>();
const emit = defineEmits<{ refetch: [] }>();

const { t } = useI18n();
const { handle } = useApiError();
const toast = useToast();
const { can } = useCan();

const WRITE_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ENGINEER];
const canWrite = computed(() => can(WRITE_ROLES));

const isTerminal = computed(
  () =>
    props.project.status === ProjectStatus.COMPLETED ||
    props.project.status === ProjectStatus.CANCELLED,
);

const draft = ref<number>(Number(props.project.progressPercentage));
const original = computed(() => Number(props.project.progressPercentage));
const dirty = computed(() => draft.value !== original.value);
const submitting = ref(false);

watch(() => props.project.progressPercentage, (v) => {
  draft.value = Number(v);
});

const percentageRule = (v: unknown) => {
  const n = Number(v);
  return (Number.isFinite(n) && n >= 0 && n <= 100) || t('projects.errors.percentage');
};

async function save() {
  if (!dirty.value) return;
  submitting.value = true;
  try {
    await projectsApi.update(props.project.id, { progressPercentage: draft.value });
    toast.success(t('common.saved'));
    emit('refetch');
  } catch (e) {
    handle(e);
  } finally {
    submitting.value = false;
  }
}

function reset() {
  draft.value = original.value;
}
</script>

<template>
  <div>
    <h2 class="text-h6 mb-3">{{ t('projects.progress.title') }}</h2>

    <v-alert
      v-if="isTerminal"
      :type="project.status === ProjectStatus.COMPLETED ? 'success' : 'warning'"
      variant="tonal"
      class="mb-4"
    >
      {{ project.status === ProjectStatus.COMPLETED
          ? t('projects.locked.completed')
          : t('projects.locked.cancelled') }}
    </v-alert>

    <v-card variant="outlined">
      <v-card-text class="space-y-4">
        <div>
          <div class="flex items-center justify-between mb-2">
            <div class="text-medium-emphasis text-sm">
              {{ t('projects.progress.current') }}
            </div>
            <div class="text-h4 font-medium">{{ draft }}%</div>
          </div>
          <ProjectProgressBar :value="draft" :height="20" />
        </div>

        <v-slider
          v-model="draft"
          :min="0"
          :max="100"
          :step="1"
          :disabled="!canWrite || isTerminal"
          thumb-label
          show-ticks="always"
          tick-size="2"
        />

        <v-text-field
          v-model.number="draft"
          :label="t('projects.fields.progress')"
          type="number"
          min="0"
          max="100"
          step="1"
          :rules="[percentageRule]"
          :disabled="!canWrite || isTerminal"
          suffix="%"
          density="compact"
        />
      </v-card-text>

      <RoleGate :roles="WRITE_ROLES">
        <v-divider v-if="!isTerminal" />
        <v-card-actions v-if="!isTerminal" class="px-4 pb-4">
          <v-btn variant="text" :disabled="!dirty || submitting" @click="reset">
            {{ t('common.cancel') }}
          </v-btn>
          <v-spacer />
          <v-btn
            color="primary"
            variant="flat"
            :disabled="!dirty"
            :loading="submitting"
            @click="save"
          >
            {{ t('common.save') }}
          </v-btn>
        </v-card-actions>
      </RoleGate>
    </v-card>
  </div>
</template>
