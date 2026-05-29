<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useTunnel } from '@/composables/useTunnel';
import { useTunnelStore } from '@/stores/tunnel.store';

const { t } = useI18n();
const { enable, disable } = useTunnel();
const store = useTunnelStore();

// Enable is allowed unless the binary is missing or we're already enabled.
// Disable is allowed only when the feature is currently on (or stuck in an
// error state that the user wants to clear). Both buttons go through their
// composable wrappers so duplicate-click protection (store.acting) and the
// confirmation dialog are centralized.
const canEnable = computed(
  () => !store.enabled && store.cloudflaredAvailable && !store.acting,
);
const canDisable = computed(() => store.enabled && !store.acting);

const enableDisabledReason = computed(() => {
  if (store.acting) return t('tunnel.actions.actingHint');
  if (!store.cloudflaredAvailable) return t('tunnel.errors.binaryMissing.title');
  if (store.enabled) return t('tunnel.actions.alreadyEnabled');
  return '';
});
</script>

<template>
  <v-card variant="outlined" rounded="lg" class="pa-5">
    <div class="text-subtitle-1 font-medium mb-1">
      {{ t('tunnel.actions.title') }}
    </div>
    <p class="text-body-2 text-medium-emphasis mb-4">
      {{ t('tunnel.actions.subtitle') }}
    </p>

    <div class="flex flex-wrap gap-3">
      <v-btn
        color="primary"
        prepend-icon="mdi-play-circle-outline"
        :loading="store.acting && !store.enabled"
        :disabled="!canEnable"
        @click="enable"
      >
        {{ t('tunnel.actions.enable') }}
      </v-btn>

      <v-btn
        color="error"
        variant="outlined"
        prepend-icon="mdi-stop-circle-outline"
        :loading="store.acting && store.enabled"
        :disabled="!canDisable"
        @click="disable"
      >
        {{ t('tunnel.actions.disable') }}
      </v-btn>
    </div>

    <p
      v-if="!canEnable && !store.enabled && enableDisabledReason"
      class="text-caption text-medium-emphasis mt-3 mb-0"
    >
      <v-icon icon="mdi-information-outline" size="small" class="me-1" />
      {{ enableDisabledReason }}
    </p>
  </v-card>
</template>
