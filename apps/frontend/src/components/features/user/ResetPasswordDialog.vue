<script setup lang="ts">
import { ref, watch } from 'vue';
import { t } from '@/i18n';
import { usersApi } from '@/services/api/users.api';
import { useApiError } from '@/composables/useApiError';
import { useToast } from '@/composables/useToast';
import type { User } from '@/types/user';

const props = defineProps<{ modelValue: boolean; user: User | null }>();
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'done'): void;
}>();

const toast = useToast();
const { fieldErrors, handle, clear } = useApiError();

const newPassword = ref('');
const submitting = ref(false);

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      newPassword.value = '';
      clear();
    }
  },
);

const minLenRule = (v: string) => (v?.length ?? 0) >= 8 || t('users.errors.passwordMin');

function close() {
  emit('update:modelValue', false);
}

async function submit() {
  if (!props.user || newPassword.value.length < 8) return;
  clear();
  submitting.value = true;
  try {
    await usersApi.resetPassword(props.user.id, newPassword.value);
    toast.success(t('users.toast.passwordReset'));
    emit('done');
    close();
  } catch (e) {
    handle(e);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="460" @update:model-value="close">
    <v-card>
      <v-card-title>{{ t('users.resetPassword.title') }}</v-card-title>
      <v-card-subtitle v-if="user" class="pb-0">
        {{ user.fullName }} ({{ user.username }})
      </v-card-subtitle>
      <v-form @submit.prevent="submit">
        <v-card-text>
          <p class="text-body-2 text-medium-emphasis mb-3">
            {{ t('users.resetPassword.hint') }}
          </p>
          <v-text-field
            v-model="newPassword"
            :label="t('users.resetPassword.newPassword')"
            type="password"
            autocomplete="new-password"
            :rules="[minLenRule]"
            :error-messages="fieldErrors.newPassword"
            autofocus
          />
        </v-card-text>
        <v-divider />
        <v-card-actions class="px-4 py-3">
          <v-btn variant="text" :disabled="submitting" @click="close">{{ t('common.cancel') }}</v-btn>
          <v-spacer />
          <v-btn type="submit" color="primary" variant="flat" :loading="submitting">
            {{ t('users.resetPassword.submit') }}
          </v-btn>
        </v-card-actions>
      </v-form>
    </v-card>
  </v-dialog>
</template>
