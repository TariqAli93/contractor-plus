<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { t } from '@/i18n';
import { settingsApi } from '@/services/api/settings.api';
import { useToast } from '@/composables/useToast';
import { useApiError } from '@/composables/useApiError';
import type { GeneralSettings } from '@/types/settings';
import SettingsCard from './SettingsCard.vue';
import ErrorState from '@/components/shared/ErrorState.vue';

const toast = useToast();
const { handle } = useApiError();

const loading = ref(false);
const saving = ref(false);
const error = ref<unknown>(null);

// Two snapshots of the form: `pristine` is what came from the server;
// `form` is what the user is editing. Diffing the two drives both the
// dirty indicator and the PATCH payload (we only send fields that changed).
const pristine = ref<GeneralSettings | null>(null);
const form = reactive<GeneralSettings>({
  appName: '',
  fiscalYearStartMonth: 1,
  defaultLocale: 'ar',
  dateFormat: 'yyyy-MM-dd',
});

const months = computed(() =>
  Array.from({ length: 12 }, (_, i) => ({
    value: i + 1,
    title: t(`settings.general.months.${i + 1}`),
  })),
);

const dateFormats = ['yyyy-MM-dd', 'dd/MM/yyyy', 'MM/dd/yyyy', 'dd-MM-yyyy'];

const isDirty = computed(() => {
  if (!pristine.value) return false;
  return (
    form.appName !== pristine.value.appName ||
    form.fiscalYearStartMonth !== pristine.value.fiscalYearStartMonth ||
    form.defaultLocale !== pristine.value.defaultLocale ||
    form.dateFormat !== pristine.value.dateFormat
  );
});

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const data = await settingsApi.getGeneral();
    applyServerData(data);
  } catch (e) {
    error.value = e;
  } finally {
    loading.value = false;
  }
}

function applyServerData(data: GeneralSettings) {
  pristine.value = data;
  form.appName = data.appName;
  form.fiscalYearStartMonth = data.fiscalYearStartMonth;
  form.defaultLocale = data.defaultLocale;
  form.dateFormat = data.dateFormat;
}

function discard() {
  if (pristine.value) applyServerData(pristine.value);
}

async function save() {
  if (!isDirty.value || saving.value) return;
  saving.value = true;
  try {
    const data = await settingsApi.updateGeneral({
      appName: form.appName,
      fiscalYearStartMonth: form.fiscalYearStartMonth,
      defaultLocale: form.defaultLocale,
      dateFormat: form.dateFormat,
    });
    applyServerData(data);
    toast.success(t('settings.saved'));
  } catch (e) {
    handle(e);
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <SettingsCard
    :title="t('settings.general.title')"
    :description="t('settings.general.description')"
    icon="mdi-tune"
  >
    <ErrorState v-if="error" :error="error" @retry="load" />

    <div v-else-if="loading && !pristine" class="space-y-4">
      <v-skeleton-loader type="heading" />
      <v-skeleton-loader type="paragraph" />
    </div>

    <form v-else class="grid grid-cols-1 sm:grid-cols-2 gap-4" @submit.prevent="save">
      <v-text-field
        v-model="form.appName"
        :label="t('settings.general.appName')"
        maxlength="120"
        counter
      />
      <v-select
        v-model="form.fiscalYearStartMonth"
        :items="months"
        item-title="title"
        item-value="value"
        :label="t('settings.general.fiscalYearStartMonth')"
      />
      <v-select
        v-model="form.defaultLocale"
        :items="[
          { value: 'ar', title: 'العربية' },
          { value: 'en', title: 'English' },
        ]"
        item-title="title"
        item-value="value"
        :label="t('settings.general.defaultLocale')"
      />
      <v-select
        v-model="form.dateFormat"
        :items="dateFormats"
        :label="t('settings.general.dateFormat')"
      />

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
