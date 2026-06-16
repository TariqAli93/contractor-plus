import { ref, watch } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import { templatesApi } from '@/services/api/templates.api';
import { ApiError } from '@/types/api';
import type { BuildingTemplate } from '@/types/template';

// Same shape as useMaterials. Mirrors the customers/materials pattern with the
// list's sortable columns reduced to name + createdAt (templates have no
// per-row price).
export function useTemplates() {
  const items = ref<BuildingTemplate[]>([]);
  const total = ref(0);
  const loading = ref(false);
  const error = ref<ApiError | null>(null);

  const page = ref(1);
  const pageSize = ref(20);
  const search = ref('');
  const isActive = ref<boolean | undefined>(undefined);
  const sortBy = ref<'name' | 'createdAt'>('name');
  const sortDir = ref<'asc' | 'desc'>('asc');

  const searchInput = ref('');
  const updateSearch = useDebounceFn((v: string) => {
    if (v === search.value) return;
    search.value = v;
    page.value = 1;
  }, 300);
  watch(searchInput, (v) => updateSearch(v));

  async function fetch() {
    loading.value = true;
    error.value = null;
    try {
      const res = await templatesApi.list({
        page: page.value,
        pageSize: pageSize.value,
        search: search.value || undefined,
        isActive: isActive.value,
        sortBy: sortBy.value,
        sortDir: sortDir.value,
      });
      items.value = res.items;
      total.value = res.total;
    } catch (e) {
      error.value = e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', String(e));
    } finally {
      loading.value = false;
    }
  }

  watch([page, pageSize, search, isActive, sortBy, sortDir], () => {
    void fetch();
  });

  function setIsActiveFilter(next: boolean | undefined) {
    isActive.value = next;
    page.value = 1;
  }

  return {
    items,
    total,
    loading,
    error,
    page,
    pageSize,
    search,
    searchInput,
    isActive,
    sortBy,
    sortDir,
    fetch,
    setIsActiveFilter,
  };
}
