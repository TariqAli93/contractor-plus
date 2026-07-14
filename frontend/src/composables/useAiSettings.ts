import { ref } from 'vue';
import { aiApi } from '@/services/api/ai.api';
import type { AiSettings, UpdateAiSettingsPayload } from '@/types/ai';

/**
 * AI control-panel state (Phase 2.5). Every mutation returns the fresh,
 * key-free settings so the panel stays in sync. The raw API key is passed to
 * `setKey` and never retained here after the call.
 */
export function useAiSettings() {
  const data = ref<AiSettings | null>(null);
  const loading = ref(false);
  const saving = ref(false);
  const error = ref<unknown>(null);

  async function load(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      data.value = await aiApi.settings();
    } catch (e) {
      error.value = e;
    } finally {
      loading.value = false;
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

  async function setKey(apiKey: string): Promise<void> {
    saving.value = true;
    try {
      data.value = await aiApi.setApiKey(apiKey);
    } finally {
      saving.value = false;
    }
  }

  async function clearKey(): Promise<void> {
    saving.value = true;
    try {
      data.value = await aiApi.clearApiKey();
    } finally {
      saving.value = false;
    }
  }

  return { data, loading, saving, error, load, update, setKey, clearKey };
}
