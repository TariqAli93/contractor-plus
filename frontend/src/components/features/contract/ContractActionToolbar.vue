<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { t } from '@/i18n';
import { contractsApi } from '@/services/api/contracts.api';
import { useConfirm } from '@/composables/useConfirm';
import { useToast } from '@/composables/useToast';
import { useApiError } from '@/composables/useApiError';
import { ContractStatus } from '@/types/enums';
import type { ContractWithRelations } from '@/types/contract';
import ContractStatusBadge from './ContractStatusBadge.vue';

const props = defineProps<{ contract: ContractWithRelations }>();
const emit = defineEmits<{
  refetch: [];
  estimateGenerated: [];
}>();

const router = useRouter();
const { confirm } = useConfirm();
const toast = useToast();
const { handle } = useApiError();

const isDraft = computed(() => props.contract.status === ContractStatus.DRAFT);
const isApproved = computed(() => props.contract.status === ContractStatus.APPROVED);
const hasProject = computed(() => props.contract.project !== null);

// ----- Generate estimate -----

const generating = ref(false);

async function onGenerateEstimate() {
  if (!props.contract.templateId) {
    toast.warning(t('contracts.errors.noTemplate'));
    return;
  }
  if (props.contract.items.length > 0) {
    const ok = await confirm({
      title: t('contracts.dialogs.regenerateTitle'),
      message: t('contracts.dialogs.regenerateMessage'),
      confirmText: t('contracts.actions.generateEstimate'),
      destructive: true,
    });
    if (!ok) return;
  }
  generating.value = true;
  try {
    await contractsApi.generateEstimate(props.contract.id);
    toast.success(t('contracts.toasts.estimateGenerated'));
    emit('estimateGenerated');
    emit('refetch');
  } catch (e) {
    handle(e);
  } finally {
    generating.value = false;
  }
}

// ----- Approve -----

const approveDialog = ref(false);
const approveSignedAt = ref<string>(new Date().toISOString().slice(0, 10));
const approving = ref(false);

async function performApprove() {
  approving.value = true;
  try {
    await contractsApi.approve(props.contract.id, {
      signedAt: approveSignedAt.value ? new Date(approveSignedAt.value) : undefined,
    });
    toast.success(t('contracts.toasts.approved'));
    approveDialog.value = false;
    emit('refetch');
  } catch (e) {
    handle(e);
  } finally {
    approving.value = false;
  }
}

// ----- Cancel -----

const cancelDialog = ref(false);
const cancelReason = ref('');
const cancelling = ref(false);

async function performCancel() {
  cancelling.value = true;
  try {
    await contractsApi.cancel(props.contract.id, {
      reason: cancelReason.value.trim() || undefined,
    });
    toast.success(t('contracts.toasts.cancelled'));
    cancelDialog.value = false;
    cancelReason.value = '';
    emit('refetch');
  } catch (e) {
    handle(e);
  } finally {
    cancelling.value = false;
  }
}

// ----- Create project -----

const projectDialog = ref(false);
const projectForm = ref({
  name: '',
  startDate: '',
  deliveryDate: '',
  notes: '',
});
const creatingProject = ref(false);

function openProjectDialog() {
  projectForm.value = {
    name: `Project ${props.contract.contractNumber}`,
    startDate: new Date().toISOString().slice(0, 10),
    deliveryDate: '',
    notes: '',
  };
  projectDialog.value = true;
}

async function performCreateProject() {
  creatingProject.value = true;
  try {
    const project = await contractsApi.createProject(props.contract.id, {
      name: projectForm.value.name.trim() || undefined,
      startDate: projectForm.value.startDate
        ? new Date(projectForm.value.startDate)
        : undefined,
      deliveryDate: projectForm.value.deliveryDate
        ? new Date(projectForm.value.deliveryDate)
        : undefined,
      notes: projectForm.value.notes.trim() || null,
    });
    toast.success(t('contracts.toasts.projectCreated'));
    projectDialog.value = false;
    emit('refetch');
    // Hop to the new project so user can manage it.
    void router.push(`/projects/${project.id}`);
  } catch (e) {
    handle(e);
  } finally {
    creatingProject.value = false;
  }
}
</script>

<template>
  <!-- Single root so the parent's `class` (e.g. mb-4) inherits cleanly. The
       v-dialogs teleport out of this subtree, so wrapping costs nothing. -->
  <div>
    <v-card>
      <v-card-text class="flex items-center gap-3 flex-wrap">
        <ContractStatusBadge :status="contract.status" size="default" />

      <v-spacer />

      <!-- DRAFT actions -->
      <template v-if="isDraft">
        <v-btn
          variant="tonal"
          prepend-icon="mdi-calculator-variant-outline"
          :loading="generating"
          @click="onGenerateEstimate"
        >
          {{ t('contracts.actions.generateEstimate') }}
        </v-btn>
        <v-btn
          color="success"
          variant="flat"
          prepend-icon="mdi-check-circle"
          @click="approveDialog = true"
        >
          {{ t('contracts.actions.approve') }}
        </v-btn>
        <v-btn
          color="error"
          variant="text"
          prepend-icon="mdi-cancel"
          @click="cancelDialog = true"
        >
          {{ t('contracts.actions.cancel') }}
        </v-btn>
      </template>

      <!-- APPROVED actions -->
      <template v-else-if="isApproved">
        <v-btn
          v-if="!hasProject"
          color="primary"
          variant="flat"
          prepend-icon="mdi-rocket-launch-outline"
          @click="openProjectDialog"
        >
          {{ t('contracts.actions.createProject') }}
        </v-btn>
        <v-btn
          v-else
          variant="tonal"
          prepend-icon="mdi-office-building-outline"
          :to="`/projects/${contract.project!.id}`"
        >
          {{ t('contracts.actions.viewProject') }}
        </v-btn>
        <v-tooltip
          v-if="hasProject"
          :text="t('contracts.tooltips.cannotCancelWithProject')"
          location="bottom"
        >
          <template #activator="{ props: tipProps }">
            <span v-bind="tipProps">
              <v-btn
                color="error"
                variant="text"
                prepend-icon="mdi-cancel"
                disabled
              >
                {{ t('contracts.actions.cancel') }}
              </v-btn>
            </span>
          </template>
        </v-tooltip>
        <v-btn
          v-else
          color="error"
          variant="text"
          prepend-icon="mdi-cancel"
          @click="cancelDialog = true"
        >
          {{ t('contracts.actions.cancel') }}
        </v-btn>
      </template>

      <!-- CANCELLED: only badge shown above; no actions -->
      </v-card-text>
    </v-card>

    <!-- Approve dialog -->
    <v-dialog v-model="approveDialog" max-width="480" persistent>
    <v-card>
      <v-card-title>{{ t('contracts.dialogs.approveTitle') }}</v-card-title>
      <v-card-text>
        <p class="mb-3">{{ t('contracts.dialogs.approveMessage') }}</p>
        <v-text-field
          v-model="approveSignedAt"
          :label="t('contracts.fields.signedAt')"
          type="date"
          density="comfortable"
        />
      </v-card-text>
      <v-card-actions class="px-4 pb-4">
        <v-spacer />
        <v-btn variant="text" :disabled="approving" @click="approveDialog = false">
          {{ t('common.cancel') }}
        </v-btn>
        <v-btn color="success" variant="flat" :loading="approving" @click="performApprove">
          {{ t('contracts.actions.approve') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <!-- Cancel dialog -->
  <v-dialog v-model="cancelDialog" max-width="480" persistent>
    <v-card>
      <v-card-title>{{ t('contracts.dialogs.cancelTitle') }}</v-card-title>
      <v-card-text>
        <p class="mb-3">{{ t('contracts.dialogs.cancelMessage') }}</p>
        <v-textarea
          v-model="cancelReason"
          :label="t('contracts.dialogs.cancelReason')"
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
          {{ t('contracts.actions.cancel') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <!-- Create project dialog -->
  <v-dialog v-model="projectDialog" max-width="600" persistent>
    <v-card>
      <v-card-title>{{ t('contracts.dialogs.createProjectTitle') }}</v-card-title>
      <v-card-text class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <v-text-field
          v-model="projectForm.name"
          :label="t('contracts.dialogs.projectName')"
          class="md:col-span-2"
        />
        <v-text-field
          v-model="projectForm.startDate"
          :label="t('contracts.dialogs.startDate')"
          type="date"
        />
        <v-text-field
          v-model="projectForm.deliveryDate"
          :label="t('contracts.dialogs.deliveryDate')"
          type="date"
        />
        <v-textarea
          v-model="projectForm.notes"
          :label="t('contracts.dialogs.projectNotes')"
          rows="2"
          auto-grow
          class="md:col-span-2"
        />
      </v-card-text>
      <v-card-actions class="px-4 pb-4">
        <v-spacer />
        <v-btn variant="text" :disabled="creatingProject" @click="projectDialog = false">
          {{ t('common.cancel') }}
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="creatingProject"
          @click="performCreateProject"
        >
          {{ t('contracts.actions.createProject') }}
        </v-btn>
      </v-card-actions>
    </v-card>
    </v-dialog>
  </div>
</template>
