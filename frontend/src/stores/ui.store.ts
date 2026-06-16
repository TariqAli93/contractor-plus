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

  return { sidebarCollapsed, toggleSidebar };
});
