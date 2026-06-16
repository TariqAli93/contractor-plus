import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { settingsApi } from '@/services/api/settings.api';
import {
  uploadsApi,
  type CompanyAssetState,
  type UploadedAssetResponse,
} from '@/services/api/uploads.api';
import type { Currency } from '@/types/settings';

// Lightweight settings store. App-wide pieces of state:
//   - default currency (consumed by MoneyDisplay)
//   - company assets (consumed by CompanyLogo, sidebar, login)
//
// Full settings pages own their own local form state and call the API
// directly. After a successful upload/delete the page calls
// `refreshCompanyAssets()` so every consumer (sidebar, login chip, etc.)
// re-renders reactively without a route navigation.

export const useSettingsStore = defineStore('settings', () => {
  // ---------- currency ----------

  const defaultCurrency = ref<Currency | null>(null);
  const currencyLoading = ref(false);
  const currencyLoaded = ref(false);
  const currencyError = ref<unknown>(null);
  let currencyInFlight: Promise<void> | null = null;

  async function ensureCurrencyLoaded(): Promise<void> {
    if (currencyLoaded.value || currencyInFlight) {
      return currencyInFlight ?? Promise.resolve();
    }
    currencyInFlight = loadCurrencies();
    try {
      await currencyInFlight;
    } finally {
      currencyInFlight = null;
    }
  }

  async function loadCurrencies(): Promise<void> {
    currencyLoading.value = true;
    currencyError.value = null;
    try {
      const res = await settingsApi.listCurrencies();
      defaultCurrency.value = res.items.find((c) => c.isDefault) ?? null;
      currencyLoaded.value = true;
    } catch (err) {
      // Silent on bootstrap — unauthenticated users get the formatter fallback.
      currencyError.value = err;
    } finally {
      currencyLoading.value = false;
    }
  }

  function setDefaultCurrency(currency: Currency | null) {
    defaultCurrency.value = currency;
  }

  const symbol = computed(() => defaultCurrency.value?.symbol ?? '');
  const code = computed(() => defaultCurrency.value?.code ?? '');

  // ---------- company assets (logo + stamp) ----------

  const companyAssets = ref<CompanyAssetState>({ logo: null, stamp: null });
  const assetsLoading = ref(false);
  const assetsLoaded = ref(false);
  const assetsError = ref<unknown>(null);
  let assetsInFlight: Promise<void> | null = null;

  async function ensureCompanyAssetsLoaded(): Promise<void> {
    if (assetsLoaded.value || assetsInFlight) {
      return assetsInFlight ?? Promise.resolve();
    }
    assetsInFlight = refreshCompanyAssets();
    try {
      await assetsInFlight;
    } finally {
      assetsInFlight = null;
    }
  }

  async function refreshCompanyAssets(): Promise<void> {
    assetsLoading.value = true;
    assetsError.value = null;
    try {
      companyAssets.value = await uploadsApi.getCompanyAssets();
      assetsLoaded.value = true;
    } catch (err) {
      // Anonymous users will hit 401 — that's fine; the logo simply falls
      // back to the app icon. Don't toast.
      assetsError.value = err;
    } finally {
      assetsLoading.value = false;
    }
  }

  /**
   * Apply an upload response without an extra round-trip. Called by
   * CompanyProfileTab so the sidebar/login chip update the instant the
   * server confirms a new image.
   */
  function applyAssetUploaded(res: UploadedAssetResponse) {
    if (res.kind === 'logo') {
      companyAssets.value = {
        ...companyAssets.value,
        logo: { url: res.url, mimeType: res.mimeType },
      };
    } else {
      companyAssets.value = {
        ...companyAssets.value,
        stamp: { url: res.url, mimeType: res.mimeType },
      };
    }
    assetsLoaded.value = true;
  }

  function applyAssetDeleted(kind: 'logo' | 'stamp') {
    companyAssets.value = { ...companyAssets.value, [kind]: null };
  }

  function clearCompanyAssets() {
    companyAssets.value = { logo: null, stamp: null };
    assetsLoaded.value = false;
    assetsError.value = null;
  }

  const logoUrl = computed(() => companyAssets.value.logo?.url ?? null);
  const stampUrl = computed(() => companyAssets.value.stamp?.url ?? null);

  return {
    // currency
    defaultCurrency,
    loading: currencyLoading, // legacy alias used by MoneyDisplay/useCurrencyFormat
    loaded: currencyLoaded,
    lastError: currencyError,
    symbol,
    code,
    ensureLoaded: ensureCurrencyLoaded,
    refresh: loadCurrencies,
    setDefaultCurrency,

    // company assets
    companyAssets,
    assetsLoading,
    assetsLoaded,
    assetsError,
    logoUrl,
    stampUrl,
    ensureCompanyAssetsLoaded,
    refreshCompanyAssets,
    applyAssetUploaded,
    applyAssetDeleted,
    clearCompanyAssets,
  };
});
