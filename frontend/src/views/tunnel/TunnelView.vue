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
// or the button is one click away - cheaper than burning CPU on every tab.
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
  <div class="cp-fill">
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

    <section v-if="!store.initialized" class="cp-pane cp-tunnel__loading">
      <v-skeleton-loader type="list-item-two-line, list-item-two-line, list-item-two-line" />
    </section>

    <section v-else class="cp-tunnel__workspace">
      <div class="cp-tunnel__primary">
        <TunnelStatusHero />
        <TunnelErrorGuidance />
        <TunnelActionPanel />
      </div>
      <TunnelDiagnostics />
    </section>
  </div>
</template>

<style scoped>
.cp-tunnel__loading { padding: 8px; }
.cp-tunnel__workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(300px, 0.7fr);
  gap: 6px;
  min-height: 0;
  overflow: auto;
}
.cp-tunnel__primary { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
</style>
