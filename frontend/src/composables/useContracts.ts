import { ref, watch } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import { contractsApi } from '@/services/api/contracts.api';
import { ApiError } from '@/types/api';
import type { Contract } from '@/types/contract';
import type { ContractStatus } from '@/types/enums';

export function useContracts() {
  const items = ref<Contract[]>([]);
  const total = ref(0);
  const loading = ref(false);
  const error = ref<ApiError | null>(null);

  const page = ref(1);
  const pageSize = ref(20);
  const search = ref('');
  const status = ref<ContractStatus | undefined>(undefined);
  const sortBy = ref<'createdAt' | 'contractNumber' | 'totalPrice'>('createdAt');
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
      const res = await contractsApi.list({
        page: page.value,
        pageSize: pageSize.value,
        search: search.value || undefined,
        status: status.value,
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

  watch([page, pageSize, search, status, sortBy, sortDir], () => {
    void fetch();
  });

  function setStatusFilter(next: ContractStatus | undefined) {
    status.value = next;
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
    status,
    sortBy,
    sortDir,
    fetch,
    setStatusFilter,
  };
}
