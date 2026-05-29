<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { settingsApi } from '@/services/api/settings.api';
import type { UploadedAssetResponse } from '@/services/api/uploads.api';
import { useToast } from '@/composables/useToast';
import { useApiError } from '@/composables/useApiError';
import { useSettingsStore } from '@/stores/settings.store';
import type { CompanyProfile } from '@/types/settings';
import SettingsCard from './SettingsCard.vue';
import CompanyAssetUploader from './CompanyAssetUploader.vue';
import ErrorState from '@/components/shared/ErrorState.vue';

const { t } = useI18n();
const toast = useToast();
const { handle, fieldErrors, clear: clearErrors } = useApiError();

const loading = ref(false);
const saving = ref(false);
const error = ref<unknown>(null);
const pristine = ref<CompanyProfile | null>(null);

interface FormShape {
  companyName: string;
  legalName: string;
  email: string;
  phone: string;
  address: string;
  taxNumber: string;
  registrationNumber: string;
  website: string;
  footerText: string;
  notes: string;
}

const form = reactive<FormShape>({
  companyName: '',
  legalName: '',
  email: '',
  phone: '',
  address: '',
  taxNumber: '',
  registrationNumber: '',
  website: '',
  footerText: '',
  notes: '',
});

function fromServer(p: CompanyProfile): FormShape {
  return {
    companyName: p.companyName ?? '',
    legalName: p.legalName ?? '',
    email: p.email ?? '',
    phone: p.phone ?? '',
    address: p.address ?? '',
    taxNumber: p.taxNumber ?? '',
    registrationNumber: p.registrationNumber ?? '',
    website: p.website ?? '',
    footerText: p.footerText ?? '',
    notes: p.notes ?? '',
  };
}

function apply(p: CompanyProfile) {
  pristine.value = p;
  const s = fromServer(p);
  Object.assign(form, s);
}

// Asset URLs are owned by the shared settings store so the sidebar/login
// logo update reactively the instant the user uploads here. We trigger a
// fetch on mount (deduped inside the store) and apply upload responses
// directly to avoid an extra round-trip.
const settingsStore = useSettingsStore();
const assets = computed(() => settingsStore.companyAssets);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const [profileData] = await Promise.all([
      settingsApi.getCompany(),
      settingsStore.refreshCompanyAssets(),
    ]);
    apply(profileData);
  } catch (e) {
    error.value = e;
  } finally {
    loading.value = false;
  }
}

function onAssetUploaded(res: UploadedAssetResponse) {
  settingsStore.applyAssetUploaded(res);
}

function onAssetDeleted(kind: 'logo' | 'stamp') {
  settingsStore.applyAssetDeleted(kind);
}

const isDirty = computed(() => {
  if (!pristine.value) return false;
  const s = fromServer(pristine.value);
  return (Object.keys(form) as Array<keyof FormShape>).some((k) => form[k] !== s[k]);
});

function discard() {
  if (pristine.value) apply(pristine.value);
  clearErrors();
}

async function save() {
  if (!isDirty.value || saving.value) return;
  clearErrors();
  saving.value = true;
  try {
    // Empty string → null mapping happens server-side via the zod
    // nullableString helper. We send the raw form values.
    const data = await settingsApi.updateCompany({
      companyName: form.companyName.trim(),
      legalName: form.legalName,
      email: form.email,
      phone: form.phone,
      address: form.address,
      taxNumber: form.taxNumber,
      registrationNumber: form.registrationNumber,
      website: form.website,
      footerText: form.footerText,
      notes: form.notes,
    });
    apply(data);
    toast.success(t('settings.saved'));
  } catch (e) {
    handle(e);
  } finally {
    saving.value = false;
  }
}

onMounted(load);

function fieldError(name: string): string {
  return fieldErrors.value[name]?.[0] ?? '';
}
</script>

<template>
  <SettingsCard
    :title="t('settings.company.title')"
    :description="t('settings.company.description')"
    icon="mdi-domain"
  >
    <ErrorState v-if="error" :error="error" @retry="load" />

    <div v-else-if="loading && !pristine" class="space-y-4">
      <v-skeleton-loader type="heading" />
      <v-skeleton-loader type="paragraph" />
    </div>

    <form v-else class="grid grid-cols-1 sm:grid-cols-2 gap-4" @submit.prevent="save">
      <v-text-field
        v-model="form.companyName"
        :label="t('settings.company.companyName') + ' *'"
        maxlength="200"
        :error-messages="fieldError('companyName')"
        required
      />
      <v-text-field
        v-model="form.legalName"
        :label="t('settings.company.legalName')"
        maxlength="200"
        :error-messages="fieldError('legalName')"
      />
      <v-text-field
        v-model="form.email"
        :label="t('settings.company.email')"
        type="email"
        maxlength="200"
        :error-messages="fieldError('email')"
      />
      <v-text-field
        v-model="form.phone"
        :label="t('settings.company.phone')"
        maxlength="50"
        :error-messages="fieldError('phone')"
      />
      <v-text-field
        v-model="form.taxNumber"
        :label="t('settings.company.taxNumber')"
        maxlength="50"
        :error-messages="fieldError('taxNumber')"
      />
      <v-text-field
        v-model="form.registrationNumber"
        :label="t('settings.company.registrationNumber')"
        maxlength="50"
        :error-messages="fieldError('registrationNumber')"
      />
      <v-text-field
        v-model="form.website"
        :label="t('settings.company.website')"
        maxlength="200"
        :error-messages="fieldError('website')"
        class="sm:col-span-2"
      />
      <v-textarea
        v-model="form.address"
        :label="t('settings.company.address')"
        rows="2"
        maxlength="500"
        counter
        :error-messages="fieldError('address')"
        class="sm:col-span-2"
      />
      <v-textarea
        v-model="form.footerText"
        :label="t('settings.company.footerText')"
        rows="2"
        maxlength="1000"
        counter
        :error-messages="fieldError('footerText')"
        class="sm:col-span-2"
      />
      <v-textarea
        v-model="form.notes"
        :label="t('settings.company.notes')"
        rows="2"
        maxlength="2000"
        counter
        :error-messages="fieldError('notes')"
        class="sm:col-span-2"
      />

      <div class="sm:col-span-2 cp-company-assets">
        <div>
          <p class="cp-eyebrow mb-2">{{ t('settings.company.assets.logoTitle') }}</p>
          <CompanyAssetUploader
            kind="logo"
            :current-url="assets.logo?.url ?? null"
            shape="square"
            :hint="t('settings.company.assets.logoHint')"
            @uploaded="onAssetUploaded"
            @deleted="() => onAssetDeleted('logo')"
          />
        </div>
        <div>
          <p class="cp-eyebrow mb-2">{{ t('settings.company.assets.stampTitle') }}</p>
          <CompanyAssetUploader
            kind="stamp"
            :current-url="assets.stamp?.url ?? null"
            shape="rect"
            :hint="t('settings.company.assets.stampHint')"
            @uploaded="onAssetUploaded"
            @deleted="() => onAssetDeleted('stamp')"
          />
        </div>
      </div>

      <div class="sm:col-span-2 flex items-center justify-end gap-2 pt-2">
        <transition name="cp-fade">
          <span v-if="isDirty" class="text-warning text-sm me-2">
            <v-icon icon="mdi-circle-medium" size="16" />
            {{ t('settings.unsaved') }}
          </span>
        </transition>
        <v-btn variant="text" :disabled="!isDirty || saving" @click="discard">
          {{ t('settings.discard') }}
        </v-btn>
        <v-btn
          type="submit"
          color="primary"
          :loading="saving"
          :disabled="!isDirty"
          prepend-icon="mdi-content-save-outline"
        >
          {{ t('settings.saveChanges') }}
        </v-btn>
      </div>
    </form>
  </SettingsCard>
</template>

<style scoped>
.cp-company-assets {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  padding-top: 8px;
  border-top: 1px solid var(--cp-border);
  margin-top: 8px;
}
</style>
