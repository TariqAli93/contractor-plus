<script setup lang="ts">
// The explicit confirmation gate for a proposed AI write. Shows the preview,
// collects any required secret (e.g. a new user's password) in a secure field
// never sent to the model, and confirms the action by its actionId. The confirm
// button is disabled while executing (no double submit) and until every required
// secret is supplied.
import { computed, ref, watch } from 'vue';
import { t } from '@/i18n';
import type { PendingAction } from '@/types/aiActions';
import AiActionPreviewCard from './AiActionPreviewCard.vue';

const props = defineProps<{
  modelValue: boolean;
  action: PendingAction | null;
  executing?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'confirm', secrets: Record<string, string> | undefined): void;
  (e: 'cancel'): void;
}>();

const secrets = ref<Record<string, string>>({});
// Reset secrets whenever the action changes (never carry one over).
watch(
  () => props.action?.actionId,
  () => {
    secrets.value = {};
  },
);

const requiredSecrets = computed(() => props.action?.requiredSecrets ?? []);
const missingSecret = computed(() =>
  requiredSecrets.value.some((k) => !(secrets.value[k] && secrets.value[k].length >= 8)),
);

function secretLabel(key: string): string {
  return key === 'password' ? t('aiActions.password') : key;
}

function onConfirm() {
  if (props.executing || missingSecret.value) return;
  emit('confirm', requiredSecrets.value.length ? { ...secrets.value } : undefined);
}

function onCancel() {
  emit('cancel');
  emit('update:modelValue', false);
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="520"
    :persistent="executing"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card v-if="action">
      <v-card-title class="cp-confirm__title">
        <v-icon size="18" class="me-2">mdi-shield-check-outline</v-icon>
        {{ action.title }}
      </v-card-title>
      <v-divider />
      <v-card-text>
        <AiActionPreviewCard :action="action" />

        <div v-if="requiredSecrets.length" class="cp-confirm__secrets">
          <v-text-field
            v-for="k in requiredSecrets"
            :key="k"
            v-model="secrets[k]"
            :label="secretLabel(k)"
            type="password"
            autocomplete="new-password"
            density="compact"
            variant="outlined"
            hide-details="auto"
            :hint="t('aiActions.secretHint')"
          />
        </div>
      </v-card-text>
      <v-divider />
      <v-card-actions>
        <v-btn variant="text" :disabled="executing" @click="onCancel">
          {{ t('common.cancel') }}
        </v-btn>
        <v-spacer />
        <v-btn
          color="primary"
          variant="flat"
          :loading="executing"
          :disabled="executing || missingSecret"
          @click="onConfirm"
        >
          {{ t('aiActions.confirm') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.cp-confirm__title {
  display: flex;
  align-items: center;
  font-size: 1rem;
  font-weight: 600;
}
.cp-confirm__secrets {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
