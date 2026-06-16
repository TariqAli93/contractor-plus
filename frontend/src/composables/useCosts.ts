import { ref, watch } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import { costsApi } from '@/services/api/costs.api';
import { ApiError } from '@/types/api';
import type { CostWithMaterial } from '@/types/cost';
import type { CostCategory } from '@/types/enums';

// List-page state for /costs. Same pattern as useCustomers / useProjects:
// owns pagination + filters + sort, refetches on any input change. Search is
// debounced; everything else is immediate. Caller can pre-bind projectId via
// setProjectFilter (used when the user lands from a project page).
export function useCosts() {
  const items = ref<CostWithMaterial[]>([]);
  const total = ref(0);
  const loading = ref(false);
  const error = ref<ApiError | null>(null);

  const page = ref(1);
  const pageSize = ref(20);
  const search = ref('');
  const projectId = ref<string | undefined>(undefined);
  const category = ref<CostCategory | undefined>(undefined);
  const dateFrom = ref<string | undefined>(undefined);
  const dateTo = ref<string | undefined>(undefined);
  const sortBy = ref<'date' | 'totalAmount' | 'createdAt'>('date');
  const sortDir = ref<'asc' | 'desc'>('desc');

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
      const res = await costsApi.list({
        page: page.value,
        pageSize: pageSize.value,
        search: search.value || undefined,
        projectId: projectId.value,
        category: category.value,
        dateFrom: dateFrom.value,
        dateTo: dateTo.value,
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

  watch(
    [page, pageSize, search, projectId, category, dateFrom, dateTo, sortBy, sortDir],
    () => {
      void fetch();
    },
  );

  function setProjectFilter(id: string | undefined) {
    projectId.value = id;
    page.value = 1;
  }

  function setCategoryFilter(c: CostCategory | undefined) {
    category.value = c;
    page.value = 1;
  }

  function setDateRange(from: string | undefined, to: string | undefined) {
    dateFrom.value = from;
    dateTo.value = to;
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
    projectId,
    category,
    dateFrom,
    dateTo,
    sortBy,
    sortDir,
    fetch,
    setProjectFilter,
    setCategoryFilter,
    setDateRange,
  };
}
