<script setup lang="ts">
import { onKeyStroke } from '@vueuse/core';
import TopBar from './TopBar.vue';
import SideNav from './SideNav.vue';
import StatusBar from './StatusBar.vue';
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
    <StatusBar />
    <CommandPalette />
    <ShortcutsHelp />
  </v-app>
</template>

<style scoped>
.cp-main {
  background: var(--cp-bg);
}
/* Full-bleed workspace — no centered max-width column (that reads as a web
   page). Tight, even gutters like a desktop document area. */
.cp-page {
  padding: 10px clamp(10px, 1.2vw, 16px) 14px;
}
@media (max-width: 600px) {
  .cp-page {
    padding: 8px 8px 12px;
  }
}
</style>
