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
  <section class="cp-panel cp-profile-form">
    <h2 class="cp-profile-form__title">{{ t('profile.editTitle') }}</h2>
    <v-form @submit.prevent="submit">
      <div class="cp-profile-form__body">
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
      </div>
      <div class="cp-profile-form__actions">
        <v-spacer />
        <v-btn type="submit" color="primary" variant="flat" :loading="submitting">
          {{ t('common.saveChanges') }}
        </v-btn>
      </div>
    </v-form>
  </section>
</template>

<style scoped>
.cp-profile-form { overflow: hidden; }
.cp-profile-form__title {
  margin: 0;
  padding: 6px 8px;
  color: var(--cp-text);
  background: var(--cp-surface-2);
  border-block-end: 1px solid var(--cp-border);
  font-size: 0.82rem;
  font-weight: 600;
}
.cp-profile-form__body { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; padding: 8px; }
.cp-profile-form__actions { display: flex; padding: 6px 8px; background: var(--cp-surface-2); border-block-start: 1px solid var(--cp-border); }
</style>
