<script setup lang="ts">
import { computed } from 'vue';
import { t } from '@/i18n';
import { useTunnel } from '@/composables/useTunnel';
import { useTunnelStore } from '@/stores/tunnel.store';

// Compact status strip. Meaning is carried by the dot, never a large coloured
// surface, so it remains consistent with the rest of the desktop workspace.

const { toneLabel, copyPublicUrl, openPublicUrl } = useTunnel();
const store = useTunnelStore();

const dotColor = computed(() => {
  switch (store.tone) {
    case 'green':
      return 'success';
    case 'yellow':
      return 'warning';
    case 'red':
      return 'error';
    default:
      return 'secondary';
  }
});

const description = computed(() => {
  switch (store.tone) {
    case 'green':
      return t('tunnel.status.description.on');
    case 'yellow':
      return store.enabled
        ? t('tunnel.status.description.starting')
        : t('tunnel.status.description.warning');
    case 'red':
      return t('tunnel.status.description.error');
    default:
      return t('tunnel.status.description.off');
  }
});
</script>

<template>
  <section class="cp-panel cp-tunnel-status">
    <div class="flex items-start gap-4">
      <v-icon :color="dotColor" icon="mdi-circle" size="20" class="mt-1" />
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-h6 font-medium">{{ toneLabel }}</span>
          <v-chip
            v-if="store.refreshing"
            size="x-small"
            variant="text"
            prepend-icon="mdi-refresh"
          >
            {{ t('tunnel.status.refreshing') }}
          </v-chip>
        </div>
        <p class="text-body-2 mt-1 mb-0 text-medium-emphasis">
          {{ description }}
        </p>

        <div v-if="store.publicUrl" class="mt-4 flex items-center gap-2 flex-wrap">
          <v-icon icon="mdi-link-variant" size="small" />
          <a
            :href="store.publicUrl"
            target="_blank"
            rel="noopener"
            class="text-primary text-body-2 font-mono break-all"
          >
            {{ store.publicUrl }}
          </a>
          <v-btn
            size="x-small"
            variant="tonal"
            prepend-icon="mdi-content-copy"
            @click="copyPublicUrl"
          >
            {{ t('tunnel.actions.copyUrl') }}
          </v-btn>
          <v-btn
            size="x-small"
            variant="tonal"
            prepend-icon="mdi-open-in-new"
            @click="openPublicUrl"
          >
            {{ t('tunnel.actions.openUrl') }}
          </v-btn>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.cp-tunnel-status { padding: 8px; }
</style>
