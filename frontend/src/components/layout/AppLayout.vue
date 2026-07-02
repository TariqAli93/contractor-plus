<script setup lang="ts">
import { onKeyStroke } from '@vueuse/core';
import TopBar from './TopBar.vue';
import SideNav from './SideNav.vue';
import CommandPalette from './CommandPalette.vue';
import ShortcutsHelp from './ShortcutsHelp.vue';
import { useUiStore } from '@/stores/ui.store';
import { useQuickNav } from '@/composables/useQuickNav';

const ui = useUiStore();

// Global command palette shortcut: Ctrl+K (Windows/Linux) or ⌘+K (mac).
onKeyStroke(['k', 'K'], (e) => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    ui.togglePalette();
  }
});

// Gmail-style "g then <key>" section jumps.
useQuickNav();

// `?` opens the keyboard-shortcuts help (ignored while typing in a field).
onKeyStroke(['?'], (e) => {
  const el = e.target as HTMLElement | null;
  const tag = el?.tagName;
  if (el?.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  e.preventDefault();
  ui.toggleHelp();
});
</script>

<template>
  <v-app>
    <TopBar />
    <SideNav />
    <v-main class="cp-main">
      <div class="cp-page">
        <router-view v-slot="{ Component, route }">
          <transition name="cp-fade" mode="out-in">
            <component :is="Component" :key="route.fullPath" />
          </transition>
        </router-view>
      </div>
    </v-main>
    <CommandPalette />
    <ShortcutsHelp />
  </v-app>
</template>

<style scoped>
.cp-main {
  background: var(--cp-bg);
}
.cp-page {
  margin-inline: auto;
  padding: 24px clamp(16px, 3vw, 32px) 48px;
}
@media (max-width: 600px) {
  .cp-page {
    padding: 16px 12px 32px;
  }
}
</style>
