import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

const SIDEBAR_KEY = 'contractor-plus.sidebar-collapsed';

function readSidebarCollapsed(): boolean {
  return globalThis.localStorage?.getItem(SIDEBAR_KEY) === 'true';
}

export const useUiStore = defineStore('ui', () => {
  const sidebarCollapsed = ref<boolean>(readSidebarCollapsed());

  watch(sidebarCollapsed, (v) => {
    globalThis.localStorage?.setItem(SIDEBAR_KEY, String(v));
  });

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value;
  }

  // Global command palette (Ctrl/⌘+K). Open state lives here so any component
  // — the topbar button, a keyboard hook, a quick-action — can drive it.
  const paletteOpen = ref(false);
  function openPalette() {
    paletteOpen.value = true;
  }
  function closePalette() {
    paletteOpen.value = false;
  }
  function togglePalette() {
    paletteOpen.value = !paletteOpen.value;
  }

  // Keyboard-shortcuts help overlay (opened with `?` or the topbar button).
  const helpOpen = ref(false);
  function toggleHelp() {
    helpOpen.value = !helpOpen.value;
  }

  return {
    sidebarCollapsed,
    toggleSidebar,
    paletteOpen,
    openPalette,
    closePalette,
    togglePalette,
    helpOpen,
    toggleHelp,
  };
});
