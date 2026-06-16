import { ref, watch } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import { customersApi } from '@/services/api/customers.api';
import { ApiError } from '@/types/api';
import type { Customer } from '@/types/customer';

// List-page state for /customers. Owns:
//  - pagination + sort + search
//  - the current page of rows + total count
//  - loading and error refs the view binds to
//
// Refetch is triggered automatically when any of the inputs change.
// Search is debounced to keep the input feel snappy without thrashing the API.
export function useCustomers() {
  const items = ref<Customer[]>([]);
  const total = ref(0);
  const loading = ref(false);
  const error = ref<ApiError | null>(null);

  const page = ref(1);
  const pageSize = ref(20);
  const search = ref('');
  const sortBy = ref<'name' | 'createdAt'>('createdAt');
  const sortDir = ref<'asc' | 'desc'>('desc');

  // Internal debounced search input — bound by the view's SearchBar.
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
      const res = await customersApi.list({
        page: page.value,
        pageSize: pageSize.value,
        search: search.value || undefined,
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

  // Refetch on any input change.
  watch([page, pageSize, search, sortBy, sortDir], () => {
    void fetch();
  });

  return {
    items,
    total,
    loading,
    error,
    page,
    pageSize,
    search,
    searchInput,
    sortBy,
    sortDir,
    fetch,
  };
}
