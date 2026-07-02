<script setup lang="ts">
import { onActivated, onMounted, onUnmounted } from 'vue';
import { t } from '@/i18n';
import { useEventListener } from '@vueuse/core';
import { useTunnel } from '@/composables/useTunnel';
import { useTunnelStore } from '@/stores/tunnel.store';
import PageHeader from '@/components/shared/PageHeader.vue';
import TunnelStatusHero from '@/components/features/tunnel/TunnelStatusHero.vue';
import TunnelActionPanel from '@/components/features/tunnel/TunnelActionPanel.vue';
import TunnelErrorGuidance from '@/components/features/tunnel/TunnelErrorGuidance.vue';
import TunnelDiagnostics from '@/components/features/tunnel/TunnelDiagnostics.vue';

const { refresh } = useTunnel();
const store = useTunnelStore();

// Refresh strategy: explicit Refresh button + on-mount + on-window-focus.
// No polling. Tunnels rarely flap; if the user wants the latest, the chip
// or the button is one click away — cheaper than burning CPU on every tab.
onMounted(() => void refresh());
onActivated(() => void refresh({ silent: true }));

// useEventListener auto-removes on unmount; the explicit onUnmounted is
// kept as documentation that nothing leaks.
useEventListener(window, 'focus', () => void refresh({ silent: true }));
onUnmounted(() => {
  /* listener cleanup handled by useEventListener */
});
</script>

<template>
  <div class="space-y-4">
    <!-- Header -->
    <PageHeader :title="t('tunnel.page.title')" :subtitle="t('tunnel.page.subtitle')" icon="mdi-tunnel">
      <v-btn
        variant="text"
        prepend-icon="mdi-refresh"
        :loading="store.refreshing"
        :disabled="store.refreshing || store.acting"
        @click="refresh()"
      >
        {{ t('tunnel.actions.refresh') }}
      </v-btn>
    </PageHeader>

    <!-- First-load skeleton. Once we have ever loaded data, we keep it
         visible during refreshes (preserve last-known state). -->
    <v-skeleton-loader v-if="!store.initialized" type="card, article, list-item-three-line" />

    <template v-else>
      <TunnelStatusHero />
      <TunnelErrorGuidance />
      <TunnelActionPanel />
      <TunnelDiagnostics />
    </template>
  </div>
</template>
