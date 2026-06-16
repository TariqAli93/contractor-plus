<script setup lang="ts">
import { computed } from 'vue';
import { useTunnelStore } from '@/stores/tunnel.store';
import { useTunnel } from '@/composables/useTunnel';

const store = useTunnelStore();
const { toneLabel } = useTunnel();

// Hidden by default — only present in the topbar once the user has ever
// interacted with the tunnel (initialized) AND there is something to say:
// either the feature is in use or the last operation left an error.
const visible = computed(
  () =>
    store.initialized &&
    (store.enabled || store.running || store.lastError !== null),
);

const color = computed(() => {
  switch (store.tone) {
    case 'green':
      return 'success';
    case 'yellow':
      return 'warning';
    case 'red':
      return 'error';
    default:
      return undefined;
  }
});
</script>

<template>
  <RouterLink v-if="visible" to="/tunnel" class="no-underline">
    <v-chip
      size="small"
      variant="tonal"
      :color="color"
      prepend-icon="mdi-tunnel"
    >
      {{ toneLabel }}
    </v-chip>
  </RouterLink>
</template>
