<script setup lang="ts">
// The application shell. Five stacked strips, top to bottom: title bar, menu row,
// command bar, workspace, status bar - the skeleton of a Windows business
// program. It deliberately does NOT use Vuetify's `v-app-bar` / `v-main` /
// `v-footer` layout: that system centres one bar over one content column and
// cannot stack three chrome strips above a docked navigation pane without
// fighting it. Plain flex gives exact, predictable metrics.
import { computed, onMounted } from 'vue';
import { onKeyStroke } from '@vueuse/core';
import { useRoute } from 'vue-router';
import { t, te } from '@/i18n';
import TitleBar from './TitleBar.vue';
import MenuBar from './MenuBar.vue';
import CommandBar from './CommandBar.vue';
import SideNav from './SideNav.vue';
import StatusBar from './StatusBar.vue';
import CommandPalette from './CommandPalette.vue';
import ShortcutsHelp from './ShortcutsHelp.vue';
import AiChatDrawer from '@/components/features/ai/AiChatDrawer.vue';
import AboutDialog from './AboutDialog.vue';
import { useUiStore } from '@/stores/ui.store';
import { useShellStore } from '@/stores/shell.store';
import { useQuickNav } from '@/composables/useQuickNav';

const ui = useUiStore();
const shell = useShellStore();
const route = useRoute();

const activeWorkspace = computed(() => {
  const segment = route.path.split('/').filter(Boolean)[0];
  if (!segment) return t('nav.dashboard');
  const key = `nav.${segment}`;
  return te(key) ? t(key) : t('nav.dashboard');
});

const workspaceIcon = computed(() => {
  const segment = route.path.split('/').filter(Boolean)[0];
  if (!segment) return 'mdi-view-dashboard-outline';
  const icons: Record<string, string> = {
    projects: 'mdi-office-building-outline',
    contracts: 'mdi-file-sign',
    customers: 'mdi-account-multiple-outline',
    costs: 'mdi-cash-minus',
    payments: 'mdi-cash-plus',
    reports: 'mdi-chart-box-outline',
    settings: 'mdi-cog-outline',
  };
  return icons[segment] ?? 'mdi-view-dashboard-outline';
});

onMounted(() => {
  void shell.load();
});

/** True while the caret is in a field - global keys must not steal typing. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  const tag = el?.tagName;
  return Boolean(el?.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT');
}

// Global command palette shortcut: Ctrl+K (Windows/Linux) or ⌘+K (mac).
onKeyStroke(['k', 'K'], (e) => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    ui.togglePalette();
  }
});

// Ctrl+B - collapse the navigation pane to a rail. Advertised in View ▸.
onKeyStroke(['b', 'B'], (e) => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  ui.toggleSidebar();
});

// F4 - the properties/details pane. The key Access and Visual Studio have bound
// to a property sheet for thirty years. Advertised in View ▸.
onKeyStroke('F4', (e) => {
  e.preventDefault();
  ui.toggleDetails();
});

// Gmail-style "g then <key>" section jumps.
useQuickNav();

// `?` opens the keyboard-shortcuts help (ignored while typing in a field).
onKeyStroke(['?'], (e) => {
  if (isTyping(e.target)) return;
  e.preventDefault();
  ui.toggleHelp();
});
</script>

<template>
  <v-app>
    <div class="cp-shell">
      <TitleBar />
      <MenuBar />
      <CommandBar />

      <div class="cp-body">
        <SideNav />
        <main class="cp-workspace">
          <div class="cp-document-tabs" role="tablist" :aria-label="t('common.menu')">
            <div class="cp-document-tab" role="tab" aria-selected="true">
              <v-icon :icon="workspaceIcon" size="15" />
              <span>{{ activeWorkspace }}</span>
            </div>
          </div>
          <div class="cp-workspace-content">
            <router-view v-slot="{ Component }">
              <component :is="Component" />
            </router-view>
          </div>
        </main>
      </div>

      <StatusBar />
    </div>

    <CommandPalette />
    <ShortcutsHelp />
    <AboutDialog />
    <AiChatDrawer />
  </v-app>
</template>

<style scoped>
.cp-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--cp-bg);
}

.cp-body {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: stretch;
}

/* The document area. A tight inset, not a page margin - content starts almost at
   the pane edge, the way a grid does in Access or a ledger in QuickBooks. */
.cp-workspace {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--cp-bg);
}
.cp-document-tabs {
  display: flex;
  align-items: end;
  flex: none;
  height: 28px;
  padding-inline: 6px;
  background: var(--cp-panel);
  border-block-end: 1px solid var(--cp-border);
}
.cp-document-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 27px;
  padding-inline: 9px;
  color: var(--cp-primary);
  background: var(--cp-surface);
  border: 1px solid var(--cp-border);
  border-block-end-color: var(--cp-surface);
  border-radius: var(--cp-radius-md) var(--cp-radius-md) 0 0;
  font-size: 0.76rem;
  font-weight: 600;
}
.cp-workspace-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--cp-gutter);
}
</style>
