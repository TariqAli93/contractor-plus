<script setup lang="ts">
import { computed, ref } from 'vue';
import { t } from '@/i18n';
import { ContractStatus, RoleName } from '@/types/enums';
import type { ContractWithRelations } from '@/types/contract';
import { projectsApi } from '@/services/api/projects.api';
import { useAccess } from '@/composables/useAccess';
import { useApiError } from '@/composables/useApiError';
import { useToast } from '@/composables/useToast';
import DateDisplay from '@/components/shared/DateDisplay.vue';
import RoleGate from '@/components/shared/RoleGate.vue';

const props = defineProps<{ contract: ContractWithRelations }>();
const emit = defineEmits<{ (e: 'changed'): void }>();

const { handle } = useApiError();
const toast = useToast();

const UNLINK_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN];
const UNLINK_PERMS = ['projects.unlink_contract'];

const hasProject = computed(() => props.contract.project !== null);

const guidance = computed(() => {
  if (hasProject.value) return null;
  if (props.contract.status === ContractStatus.DRAFT) return t('contracts.project.draftHint');
  if (props.contract.status === ContractStatus.CANCELLED) return t('contracts.project.cancelledHint');
  return t('contracts.project.approvedHint');
});

// ----- Safe unlink -----
const unlinkOpen = ref(false);
const reason = ref('');
const submitting = ref(false);

async function doUnlink() {
  const projectId = props.contract.project?.id;
  if (!projectId) return;
  if (reason.value.trim().length < 3) {
    toast.error(t('contracts.project.unlinkReasonRequired'));
    return;
  }
  submitting.value = true;
  try {
    await projectsApi.unlinkContract(projectId, reason.value.trim());
    toast.success(t('contracts.project.unlinked'));
    unlinkOpen.value = false;
    reason.value = '';
    emit('changed');
  } catch (e) {
    handle(e);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div>
    <h2 class="text-h6 mb-3">{{ t('contracts.project.title') }}</h2>

    <template v-if="hasProject && contract.project">
      <v-card variant="outlined">
        <v-card-text class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div class="text-medium-emphasis text-xs">{{ t('contracts.project.fields.name') }}</div>
            <div class="text-h6">{{ contract.project.name }}</div>
          </div>
          <div>
            <div class="text-medium-emphasis text-xs">{{ t('contracts.project.fields.status') }}</div>
            <v-chip size="small" variant="tonal">{{ contract.project.status }}</v-chip>
          </div>
          <div>
            <div class="text-medium-emphasis text-xs">{{ t('contracts.project.fields.startDate') }}</div>
            <DateDisplay :value="contract.project.startDate" />
          </div>
          <div>
            <div class="text-medium-emphasis text-xs">{{ t('contracts.project.fields.deliveryDate') }}</div>
            <DateDisplay :value="contract.project.deliveryDate" />
          </div>
          <div class="md:col-span-2">
            <div class="text-medium-emphasis text-xs">{{ t('contracts.project.fields.progress') }}</div>
            <v-progress-linear
              :model-value="Number(contract.project.progressPercentage)"
              height="20"
              color="primary"
              rounded
            >
              <template #default>
                <span class="text-caption">{{ contract.project.progressPercentage }}%</span>
              </template>
            </v-progress-linear>
          </div>
        </v-card-text>
        <v-divider />
        <v-card-actions>
          <RoleGate :permissions="UNLINK_PERMS" :roles="UNLINK_ROLES">
            <v-btn
              color="error"
              variant="text"
              prepend-icon="mdi-link-variant-off"
              @click="unlinkOpen = true"
            >
              {{ t('contracts.project.unlink') }}
            </v-btn>
          </RoleGate>
          <v-spacer />
          <v-btn
            color="primary"
            variant="tonal"
            prepend-icon="mdi-arrow-top-left"
            :to="`/projects/${contract.project.id}`"
          >
            {{ t('contracts.actions.viewProject') }}
          </v-btn>
        </v-card-actions>
      </v-card>

      <v-dialog v-model="unlinkOpen" max-width="520">
        <v-card>
          <v-card-title>{{ t('contracts.project.unlinkTitle') }}</v-card-title>
          <v-card-text>
            <v-alert type="warning" variant="tonal" density="comfortable" class="mb-4">
              {{ t('contracts.project.unlinkHint') }}
            </v-alert>
            <v-textarea
              v-model="reason"
              :label="t('contracts.project.reason')"
              rows="3"
              auto-grow
              counter="500"
              autofocus
            />
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn variant="text" :disabled="submitting" @click="unlinkOpen = false">
              {{ t('common.cancel') }}
            </v-btn>
            <v-btn color="error" variant="flat" :loading="submitting" @click="doUnlink">
              {{ t('contracts.project.confirmUnlink') }}
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
    </template>

    <v-alert v-else type="info" variant="tonal" icon="mdi-information-outline">
      {{ guidance }}
    </v-alert>
  </div>
</template>
