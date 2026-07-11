import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { settingsApi } from '@/services/api/settings.api';

// Facts the application chrome reports about itself: which build is running,
// which database it is bound to, and which company's books are open. Everything
// here is read once at shell mount and is allowed to be absent - the status bar
// omits a segment rather than inventing one. Nothing in this store is required
// for the app to function.
export const useShellStore = defineStore('shell', () => {
  const appVersion = ref<string | null>(null);
  const platform = ref<string | null>(null);
  const database = ref<string | null>(null);
  const companyName = ref<string | null>(null);

  const isDesktop = computed(() => Boolean(window.desktop?.isDesktop));

  let loaded = false;

  async function load(): Promise<void> {
    if (loaded) return;
    loaded = true;

    // Desktop facts come over IPC; on the web build there is no bridge and both
    // the version and the database segment simply don't render.
    try {
      const state = await window.desktop?.getState();
      if (state) {
        appVersion.value = state.appVersion;
        platform.value = state.platform;
        database.value = `${state.defaultDb.database}@${state.defaultDb.host}`;
      }
    } catch {
      // A dead bridge is not worth an error banner in the status strip.
    }

    // `/settings/company` is permission-gated; a VIEWER may not read it. Failing
    // to name the company is not an error, it just means we say nothing.
    try {
      const company = await settingsApi.getCompany();
      companyName.value = company?.companyName?.trim() || null;
    } catch {
      companyName.value = null;
    }
  }

  return { appVersion, platform, database, companyName, isDesktop, load };
});
