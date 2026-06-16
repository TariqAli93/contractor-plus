<script setup lang="ts">
import { ref } from 'vue';
import { t } from '@/i18n';
import { profileApi } from '@/services/api/profile.api';
import { useAuthStore } from '@/stores/auth.store';
import { useApiError } from '@/composables/useApiError';
import { useToast } from '@/composables/useToast';

const auth = useAuthStore();
const toast = useToast();
const { fieldErrors, handle, clear } = useApiError();

const form = ref({
  fullName: auth.user?.fullName ?? '',
  email: auth.user?.email ?? null,
  phone: auth.user?.phone ?? null,
});
const submitting = ref(false);

const requiredRule = (v: unknown) => !!v || ' ';
const emailRule = (v: string | null | undefined) =>
  !v || /.+@.+\..+/.test(v) || t('users.errors.email');

async function submit() {
  clear();
  submitting.value = true;
  try {
    const updated = await profileApi.update({
      fullName: form.value.fullName,
      email: form.value.email,
      phone: form.value.phone,
    });
    auth.user = updated;
    toast.success(t('profile.toast.saved'));
  } catch (e) {
    handle(e);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <v-card>
    <v-card-title class="text-h6">{{ t('profile.editTitle') }}</v-card-title>
    <v-divider />
    <v-form @submit.prevent="submit">
      <v-card-text class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <v-text-field
          v-model="form.fullName"
          :label="t('users.fields.fullName')"
          :rules="[requiredRule]"
          :error-messages="fieldErrors.fullName"
          class="md:col-span-2"
        />
        <v-text-field
          v-model="form.email"
          :label="t('users.fields.email')"
          type="email"
          :rules="[emailRule]"
          :error-messages="fieldErrors.email"
        />
        <v-text-field
          v-model="form.phone"
          :label="t('users.fields.phone')"
          :error-messages="fieldErrors.phone"
        />
      </v-card-text>
      <v-divider />
      <v-card-actions class="px-4 py-3">
        <v-spacer />
        <v-btn type="submit" color="primary" variant="flat" :loading="submitting">
          {{ t('common.save') }}
        </v-btn>
      </v-card-actions>
    </v-form>
  </v-card>
</template>
