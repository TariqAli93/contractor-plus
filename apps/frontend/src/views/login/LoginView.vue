<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { t } from '@/i18n';
import { useAuthStore } from '@/stores/auth.store';
import { useSettingsStore } from '@/stores/settings.store';
import { useApiError } from '@/composables/useApiError';
import CompanyLogo from '@/components/shared/CompanyLogo.vue';

const auth = useAuthStore();
const settings = useSettingsStore();
const route = useRoute();
const router = useRouter();
const { fieldErrors, handle, clear } = useApiError();

const username = ref('');
const password = ref('');
const submitting = ref(false);

const requiredRule = (v: string) => !!v || ' ';
const minLenRule = (v: string) => (v?.trim().length ?? 0) >= 3 || ' ';

async function submit() {
  clear();
  submitting.value = true;
  try {
    await auth.login(username.value, password.value);
    // After a successful login we have credentials — pull the logo + the
    // default currency so the destination page renders branded on the
    // first paint.
    void settings.ensureCompanyAssetsLoaded();
    void settings.ensureLoaded();
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/';
    router.replace(redirect);
  } catch (err) {
    handle(err);
  } finally {
    submitting.value = false;
  }
}

// If a logged-in user lands on /login (e.g. clicked the route directly),
// the assets are already in the store — the logo renders immediately.
// For first visits we don't try; the store deliberately stays empty until
// after authentication so anonymous GETs don't spam 401s.
onMounted(() => {
  if (auth.isAuthenticated) {
    void settings.ensureCompanyAssetsLoaded();
  }
});
</script>

<template>
  <div class="cp-login flex flex-col items-center gap-6">
    <CompanyLogo
      variant="login"
      :label="t('app.name')"
      :caption="t('app.tagline')"
    />

    <v-card width="400" class="pa-2" elevation="2">
      <v-card-title class="text-h5 font-medium">{{ t('auth.login') }}</v-card-title>
      <v-card-subtitle>{{ t('auth.welcome') }}</v-card-subtitle>

      <v-form @submit.prevent="submit">
        <v-card-text class="flex flex-col gap-3">
          <v-text-field
            v-model="username"
            :label="t('auth.username')"
            :placeholder="t('auth.usernamePlaceholder')"
            type="text"
            autocomplete="username"
            :rules="[requiredRule, minLenRule]"
            :error-messages="fieldErrors.username"
          />
          <v-text-field
            v-model="password"
            :label="t('auth.password')"
            type="password"
            autocomplete="current-password"
            :rules="[requiredRule]"
            :error-messages="fieldErrors.password"
          />
        </v-card-text>

        <v-card-actions class="px-4 pb-4">
          <v-btn
            type="submit"
            color="primary"
            variant="flat"
            block
            :loading="submitting"
          >
            {{ t('auth.submit') }}
          </v-btn>
        </v-card-actions>
      </v-form>
    </v-card>
  </div>
</template>
