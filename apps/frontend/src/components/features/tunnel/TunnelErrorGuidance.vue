<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useTunnel } from '@/composables/useTunnel';

// Translates a single classified failureKind into a panel with one of four
// sets of copy. At most one panel renders at a time so the page is never
// noisier than the underlying root cause.

const { t } = useI18n();
const { failureKind } = useTunnel();

interface GuidanceCopy {
  title: string;
  body: string;
  hint: string;
  color: 'error' | 'warning';
  icon: string;
}

const guidance = computed<GuidanceCopy | null>(() => {
  switch (failureKind.value) {
    case 'binary_missing':
      return {
        title: t('tunnel.errors.binaryMissing.title'),
        body: t('tunnel.errors.binaryMissing.body'),
        hint: t('tunnel.errors.binaryMissing.hint'),
        color: 'error',
        icon: 'mdi-package-variant-remove',
      };
    case 'management_offline':
      return {
        title: t('tunnel.errors.managementApi.title'),
        body: t('tunnel.errors.managementApi.body'),
        hint: t('tunnel.errors.managementApi.hint'),
        color: 'warning',
        icon: 'mdi-cloud-off-outline',
      };
    case 'config_missing':
      return {
        title: t('tunnel.errors.configMissing.title'),
        body: t('tunnel.errors.configMissing.body'),
        hint: t('tunnel.errors.configMissing.hint'),
        color: 'error',
        icon: 'mdi-file-question-outline',
      };
    case 'runtime_stopped':
      return {
        title: t('tunnel.errors.runtimeStopped.title'),
        body: t('tunnel.errors.runtimeStopped.body'),
        hint: t('tunnel.errors.runtimeStopped.hint'),
        color: 'error',
        icon: 'mdi-restart-alert',
      };
    case 'generic_error':
      return {
        title: t('tunnel.errors.generic.title'),
        body: t('tunnel.errors.generic.body'),
        hint: t('tunnel.errors.generic.hint'),
        color: 'error',
        icon: 'mdi-alert-circle-outline',
      };
    default:
      return null;
  }
});
</script>

<template>
  <v-alert
    v-if="guidance"
    :type="guidance.color"
    variant="tonal"
    :icon="guidance.icon"
    rounded="lg"
    border="start"
  >
    <div class="text-subtitle-2 font-medium">{{ guidance.title }}</div>
    <p class="text-body-2 mt-1 mb-2">{{ guidance.body }}</p>
    <p class="text-caption mb-0 text-medium-emphasis">
      <v-icon icon="mdi-lightbulb-on-outline" size="small" class="me-1" />
      {{ guidance.hint }}
    </p>
  </v-alert>
</template>
