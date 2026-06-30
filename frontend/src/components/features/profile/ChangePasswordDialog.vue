<script setup lang="ts">
import { ref, watch } from 'vue';
import { t } from '@/i18n';
import { profileApi } from '@/services/api/profile.api';
import { useToast } from '@/composables/useToast';
import { ApiError } from '@/types/api';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>();

const toast = useToast();

const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const submitting = ref(false);
const fieldErrors = ref<Record<string, string[]>>({});

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      currentPassword.value = '';
      newPassword.value = '';
      confirmPassword.value = '';
      fieldErrors.value = {};
    }
  },
);

const requiredRule = (v: string) => !!v || ' ';
const minLenRule = (v: string) => (v?.length ?? 0) >= 8 || t('users.errors.passwordMin');
const matchRule = (v: string) => v === newPassword.value || t('profile.password.mismatch');

function close() {
  emit('update:modelValue', false);
}

async function submit() {
  fieldErrors.value = {};
  if (
    !currentPassword.value ||
    newPassword.value.length < 8 ||
    newPassword.value !== confirmPassword.value
  ) {
    return;
  }
  submitting.value = true;
  try {
    await profileApi.changePassword({
      currentPassword: currentPassword.value,
      newPassword: newPassword.value,
      confirmPassword: confirmPassword.value,
    });
    toast.success(t('profile.password.changed'));
    close();
  } catch (e) {
    if (e instanceof ApiError && e.code === 'INVALID_CURRENT_PASSWORD') {
      fieldErrors.value = { currentPassword: [t('profile.password.wrongCurrent')] };
    } else if (e instanceof ApiError && e.isValidation()) {
      fieldErrors.value = e.fieldErrors();
    } else if (e instanceof ApiError) {
      toast.error(e.message, e.reqId);
    } else {
      toast.error(t('common.error'));
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="460" @update:model-value="close">
    <v-card>
      <v-card-title>{{ t('profile.password.title') }}</v-card-title>
      <v-form @submit.prevent="submit">
        <v-card-text class="flex flex-col gap-1">
          <v-text-field
            v-model="currentPassword"
            :label="t('profile.password.current')"
            type="password"
            autocomplete="current-password"
            :rules="[requiredRule]"
            :error-messages="fieldErrors.currentPassword"
            autofocus
          />
          <v-text-field
            v-model="newPassword"
            :label="t('profile.password.new')"
            type="password"
            autocomplete="new-password"
            :rules="[requiredRule, minLenRule]"
            :error-messages="fieldErrors.newPassword"
          />
          <v-text-field
            v-model="confirmPassword"
            :label="t('profile.password.confirm')"
            type="password"
            autocomplete="new-password"
            :rules="[requiredRule, matchRule]"
            :error-messages="fieldErrors.confirmPassword"
          />
        </v-card-text>
        <v-divider />
        <v-card-actions class="px-4 py-3">
          <v-btn variant="text" :disabled="submitting" @click="close">{{ t('common.cancel') }}</v-btn>
          <v-spacer />
          <v-btn type="submit" color="primary" variant="flat" :loading="submitting">
            {{ t('profile.password.submit') }}
          </v-btn>
        </v-card-actions>
      </v-form>
    </v-card>
  </v-dialog>
</template>
