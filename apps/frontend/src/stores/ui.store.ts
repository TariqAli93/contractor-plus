import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

const LOCALE_KEY = 'contractor-plus.locale';
const SIDEBAR_KEY = 'contractor-plus.sidebar-collapsed';

export type Locale = 'ar' | 'en';

function readLocale(): Locale {
  const stored = globalThis.localStorage?.getItem(LOCALE_KEY);
  if (stored === 'ar' || stored === 'en') return stored;
  const fallback = (import.meta.env.VITE_DEFAULT_LOCALE as Locale) || 'ar';
  return fallback;
}

function readSidebarCollapsed(): boolean {
  return globalThis.localStorage?.getItem(SIDEBAR_KEY) === 'true';
}

export const useUiStore = defineStore('ui', () => {
  const locale = ref<Locale>(readLocale());
  const sidebarCollapsed = ref<boolean>(readSidebarCollapsed());

  watch(locale, (v) => {
    globalThis.localStorage?.setItem(LOCALE_KEY, v);
    document.documentElement.lang = v;
    document.documentElement.dir = v === 'ar' ? 'rtl' : 'ltr';
  });

  watch(sidebarCollapsed, (v) => {
    globalThis.localStorage?.setItem(SIDEBAR_KEY, String(v));
  });

  function setLocale(next: Locale) {
    locale.value = next;
  }

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value;
  }

  return { locale, sidebarCollapsed, setLocale, toggleSidebar };
});
