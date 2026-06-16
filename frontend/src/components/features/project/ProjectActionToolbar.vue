<script setup lang="ts">
import { computed, ref } from 'vue';
import { t } from '@/i18n';
import { projectsApi } from '@/services/api/projects.api';
import { useConfirm } from '@/composables/useConfirm';
import { useToast } from '@/composables/useToast';
import { useApiError } from '@/composables/useApiError';
import { useAccess } from '@/composables/useAccess';
import { ProjectStatus, RoleName } from '@/types/enums';
import type { ProjectWithContract } from '@/types/project';
import ProjectStatusBadge from './ProjectStatusBadge.vue';

const props = defineProps<{ project: ProjectWithContract }>();
const emit = defineEmits<{ refetch: [] }>();

const { confirm } = useConfirm();
const toast = useToast();
const { handle } = useApiError();
const { canAccess } = useAccess();

// Lifecycle actions are permission-first (any projects lifecycle permission)
// with the legacy operations roles as fallback.
const WRITE_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ENGINEER];
const LIFECYCLE_PERMS = [
  'projects.update',
  'projects.start',
  'projects.pause',
  'projects.resume',
  'projects.complete',
  'projects.cancel',
];
const canWrite = computed(() => canAccess({ permissions: LIFECYCLE_PERMS, roles: WRITE_ROLES }));

const isPlanned = computed(() => props.project.status === ProjectStatus.PLANNED);
const isInProgress = computed(() => props.project.status === ProjectStatus.IN_PROGRESS);
const isPaused = computed(() => props.project.status === ProjectStatus.PAUSED);
const isTerminal = computed(
  () =>
    props.project.status === ProjectStatus.COMPLETED ||
    props.project.status === ProjectStatus.CANCELLED,
);
const canCancel = computed(() => !isTerminal.value);

// ----- Simple confirm-and-call actions -----

const running = ref<string | null>(null);

async function performAction(
  key: 'start' | 'pause' | 'resume' | 'complete',
  apiCall: () => Promise<unknown>,
  confirmOpts: { title: string; message: string; destructive?: boolean },
) {
  const ok = await confirm({
    title: confirmOpts.title,
    message: confirmOpts.message,
    confirmText: t(`projects.actions.${key}`),
    destructive: confirmOpts.destructive,
  });
  if (!ok) return;
  running.value = key;
  try {
    await apiCall();
    toast.success(t(`projects.toasts.${key}d`));
    emit('refetch');
  } catch (e) {
    handle(e);
  } finally {
    running.value = null;
  }
}

const onStart = () =>
  performAction('start', () => projectsApi.start(props.project.id), {
    title: t('projects.dialogs.startTitle'),
    message: t('projects.dialogs.startMessage'),
  });

const onPause = () =>
  performAction('pause', () => projectsApi.pause(props.project.id), {
    title: t('projects.dialogs.pauseTitle'),
    message: t('projects.dialogs.pauseMessage'),
  });

const onResume = () =>
  performAction('resume', () => projectsApi.resume(props.project.id), {
    title: t('projects.dialogs.resumeTitle'),
    message: t('projects.dialogs.resumeMessage'),
  });

const onComplete = () =>
  performAction('complete', () => projectsApi.complete(props.project.id), {
    title: t('projects.dialogs.completeTitle'),
    message: t('projects.dialogs.completeMessage'),
  });

// ----- Cancel with reason -----

const cancelDialog = ref(false);
const cancelReason = ref('');
const cancelling = ref(false);

async function performCancel() {
  cancelling.value = true;
  try {
    await projectsApi.cancel(props.project.id, {
      reason: cancelReason.value.trim() || undefined,
    });
    toast.success(t('projects.toasts.cancelled'));
    cancelDialog.value = false;
    cancelReason.value = '';
    emit('refetch');
  } catch (e) {
    handle(e);
  } finally {
    cancelling.value = false;
  }
}
</script>

<template>
  <!-- Single root so the parent's `class` (e.g. mb-4) inherits cleanly. The
       v-dialog teleports out of this subtree, so wrapping costs nothing. -->
  <div>
    <v-card>
      <v-card-text class="flex items-center gap-3 flex-wrap">
        <ProjectStatusBadge :status="project.status" size="default" />

      <v-spacer />

      <template v-if="canWrite">
        <!-- PLANNED -->
        <template v-if="isPlanned">
          <v-btn
            color="primary"
            variant="flat"
            prepend-icon="mdi-play-circle-outline"
            :loading="running === 'start'"
            @click="onStart"
          >
            {{ t('projects.actions.start') }}
          </v-btn>
        </template>

        <!-- IN_PROGRESS -->
        <template v-else-if="isInProgress">
          <v-btn
            variant="tonal"
            prepend-icon="mdi-pause-circle-outline"
            :loading="running === 'pause'"
            @click="onPause"
          >
            {{ t('projects.actions.pause') }}
          </v-btn>
          <v-btn
            color="success"
            variant="flat"
            prepend-icon="mdi-check-circle-outline"
            :loading="running === 'complete'"
            @click="onComplete"
          >
            {{ t('projects.actions.complete') }}
          </v-btn>
        </template>

        <!-- PAUSED -->
        <template v-else-if="isPaused">
          <v-btn
            color="primary"
            variant="flat"
            prepend-icon="mdi-play-circle-outline"
            :loading="running === 'resume'"
            @click="onResume"
          >
            {{ t('projects.actions.resume') }}
          </v-btn>
          <v-btn
            color="success"
            variant="tonal"
            prepend-icon="mdi-check-circle-outline"
            :loading="running === 'complete'"
            @click="onComplete"
          >
            {{ t('projects.actions.complete') }}
          </v-btn>
        </template>

        <!-- Cancel button — present in every non-terminal status -->
        <v-btn
          v-if="canCancel"
          color="error"
          variant="text"
          prepend-icon="mdi-cancel"
          @click="cancelDialog = true"
        >
          {{ t('projects.actions.cancel') }}
        </v-btn>
      </template>
      </v-card-text>
    </v-card>

    <!-- Cancel dialog -->
    <v-dialog v-model="cancelDialog" max-width="480" persistent>
    <v-card>
      <v-card-title>{{ t('projects.dialogs.cancelTitle') }}</v-card-title>
      <v-card-text>
        <p class="mb-3">{{ t('projects.dialogs.cancelMessage') }}</p>
        <v-textarea
          v-model="cancelReason"
          :label="t('projects.dialogs.cancelReason')"
          rows="2"
          auto-grow
          counter="500"
          maxlength="500"
        />
      </v-card-text>
      <v-card-actions class="px-4 pb-4">
        <v-spacer />
        <v-btn variant="text" :disabled="cancelling" @click="cancelDialog = false">
          {{ t('common.back') }}
        </v-btn>
        <v-btn color="error" variant="flat" :loading="cancelling" @click="performCancel">
          {{ t('projects.actions.cancel') }}
        </v-btn>
      </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
