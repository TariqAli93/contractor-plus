import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { vuetify, LIGHT_THEME, DARK_THEME } from '@/plugins/vuetify';

const THEME_KEY = 'contractor-plus.theme';

export type ThemeMode = 'light' | 'dark' | 'system';

function readStoredMode(): ThemeMode {
  const stored = globalThis.localStorage?.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  return 'system';
}

function systemPrefersDark(): boolean {
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export const useThemeStore = defineStore('theme', () => {
  // The user's chosen mode (persisted). 'system' follows the OS preference.
  const mode = ref<ThemeMode>(readStoredMode());
  // Tracks the live OS preference so 'system' mode reacts to changes.
  const systemDark = ref<boolean>(systemPrefersDark());

  const isDark = computed(() =>
    mode.value === 'system' ? systemDark.value : mode.value === 'dark',
  );

  const currentTheme = computed(() => (isDark.value ? DARK_THEME : LIGHT_THEME));

  function apply() {
    // Vuetify 3.7+ deprecates assigning theme.global.name.value directly.
    vuetify.theme.change(currentTheme.value);
  }

  function setTheme(next: ThemeMode) {
    mode.value = next;
    globalThis.localStorage?.setItem(THEME_KEY, next);
    apply();
  }

  // Flip between explicit light/dark. From 'system', flip away from whatever
  // the OS currently shows.
  function toggleTheme() {
    setTheme(isDark.value ? 'light' : 'dark');
  }

  function initializeTheme() {
    // React to OS theme changes while in 'system' mode.
    const mq = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener?.('change', (e) => {
      systemDark.value = e.matches;
      if (mode.value === 'system') apply();
    });
    apply();
  }

  return { mode, isDark, currentTheme, setTheme, toggleTheme, initializeTheme };
});
