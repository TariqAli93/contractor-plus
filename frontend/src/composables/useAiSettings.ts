import { ref } from 'vue';
import { aiApi } from '@/services/api/ai.api';
import type { AiModelListItem, AiSettings, UpdateAiSettingsPayload } from '@/types/ai';

/**
 * AI control-panel state. The OpenRouter key is managed from the UI (DB-first);
 * the model list is fetched LIVE from OpenRouter for the current key. Every
 * mutation returns the fresh, key-free settings. The raw key is passed to
 * `setKey` and never retained here after the call.
 */
export function useAiSettings() {
  const data = ref<AiSettings | null>(null);
  const models = ref<AiModelListItem[]>([]);
  const modelsStale = ref(false);
  const loading = ref(false);
  const modelsLoading = ref(false);
  const saving = ref(false);
  const error = ref<unknown>(null);

  async function load(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      data.value = await aiApi.settings();
      await loadModels();
    } catch (e) {
      error.value = e;
    } finally {
      loading.value = false;
    }
  }

  /** Fetch the live catalogue for the current key. Non-fatal: a failure leaves
   *  the panel usable with an empty list (the key may just need re-checking). */
  async function loadModels(refresh = false): Promise<void> {
    if (!data.value?.configured) {
      models.value = [];
      modelsStale.value = false;
      return;
    }
    modelsLoading.value = true;
    try {
      const res = await aiApi.models(refresh);
      models.value = res.models;
      modelsStale.value = res.stale;
    } catch {
      models.value = [];
      modelsStale.value = false;
    } finally {
      modelsLoading.value = false;
    }
  }

  async function update(payload: UpdateAiSettingsPayload): Promise<void> {
    saving.value = true;
    try {
      data.value = await aiApi.updateSettings(payload);
    } finally {
      saving.value = false;
    }
  }

  async function saveModels(defaultModel: string, heavyModel: string | null): Promise<void> {
    saving.value = true;
    try {
      data.value = await aiApi.updateModels({ defaultModel, heavyModel });
    } finally {
      saving.value = false;
    }
  }

  /** Validate + store a new key, then reload settings AND the model list (a new
   *  key can expose a different catalogue). Returns the reachable model count. */
  async function setKey(apiKey: string): Promise<number> {
    saving.value = true;
    try {
      const res = await aiApi.setOpenRouterKey(apiKey);
      await load();
      return res.modelCount;
    } finally {
      saving.value = false;
    }
  }

  async function clearKey(): Promise<void> {
    saving.value = true;
    try {
      data.value = await aiApi.clearOpenRouterKey();
      models.value = [];
      modelsStale.value = false;
    } finally {
      saving.value = false;
    }
  }

  return {
    data,
    models,
    modelsStale,
    loading,
    modelsLoading,
    saving,
    error,
    load,
    loadModels,
    update,
    saveModels,
    setKey,
    clearKey,
  };
}
