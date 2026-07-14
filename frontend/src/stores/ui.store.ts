import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

const SIDEBAR_KEY = 'contractor-plus.sidebar-collapsed';
const DETAILS_KEY = 'contractor-plus.details-open';

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
  // - the topbar button, a keyboard hook, a quick-action - can drive it.
  const paletteOpen = ref(false);
  // An optional initial search term (e.g. from the voice "ابحث عن …" command);
  // the palette seeds its input from this when it opens.
  const paletteQuery = ref('');
  function openPalette(query = '') {
    paletteQuery.value = query;
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

  // The right-hand properties pane, toggled with F4 - the key Access, Visual
  // Studio and every Windows property-sheet has used for decades. Persisted:
  // a workspace that forgets its panes is a web page, not a tool.
  const detailsOpen = ref<boolean>(globalThis.localStorage?.getItem(DETAILS_KEY) !== 'false');
  watch(detailsOpen, (v) => {
    globalThis.localStorage?.setItem(DETAILS_KEY, String(v));
  });
  function toggleDetails() {
    detailsOpen.value = !detailsOpen.value;
  }

  // Help ▸ About.
  const aboutOpen = ref(false);
  function toggleAbout() {
    aboutOpen.value = !aboutOpen.value;
  }

  // AI chat assistant drawer (Phase 7), opened from the command bar.
  const chatOpen = ref(false);
  function toggleChat() {
    chatOpen.value = !chatOpen.value;
  }
  function closeChat() {
    chatOpen.value = false;
  }

  return {
    sidebarCollapsed,
    toggleSidebar,
    paletteOpen,
    paletteQuery,
    openPalette,
    closePalette,
    togglePalette,
    helpOpen,
    toggleHelp,
    detailsOpen,
    toggleDetails,
    aboutOpen,
    toggleAbout,
    chatOpen,
    toggleChat,
    closeChat,
  };
});
