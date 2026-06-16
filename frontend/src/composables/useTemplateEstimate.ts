import { ref } from 'vue';
import { templatesApi } from '@/services/api/templates.api';
import { ApiError } from '@/types/api';
import type { TemplateEstimate } from '@/types/template';

// Reads the backend-computed estimate. No client-side math — frontend just
// renders what the server returned.
export function useTemplateEstimate(templateId: string) {
  const data = ref<TemplateEstimate | null>(null);
  const loading = ref(false);
  const error = ref<ApiError | null>(null);

  async function fetch() {
    loading.value = true;
    error.value = null;
    try {
      data.value = await templatesApi.getEstimate(templateId);
    } catch (e) {
      error.value = e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', String(e));
    } finally {
      loading.value = false;
    }
  }

  return { data, loading, error, fetch };
}
