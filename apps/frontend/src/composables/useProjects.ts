import { ref, watch } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import { projectsApi } from '@/services/api/projects.api';
import { ApiError } from '@/types/api';
import type { ProjectWithContract } from '@/types/project';
import type { ProjectStatus } from '@/types/enums';

export function useProjects() {
  const items = ref<ProjectWithContract[]>([]);
  const total = ref(0);
  const loading = ref(false);
  const error = ref<ApiError | null>(null);

  const page = ref(1);
  const pageSize = ref(20);
  const search = ref('');
  const status = ref<ProjectStatus | undefined>(undefined);
  const delayed = ref<boolean>(false);
  const sortBy = ref<'createdAt' | 'name' | 'deliveryDate' | 'startDate'>('deliveryDate');
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
      const res = await projectsApi.list({
        page: page.value,
        pageSize: pageSize.value,
        search: search.value || undefined,
        status: status.value,
        delayed: delayed.value || undefined,
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

  watch([page, pageSize, search, status, delayed, sortBy, sortDir], () => {
    void fetch();
  });

  function setStatusFilter(next: ProjectStatus | undefined) {
    status.value = next;
    page.value = 1;
  }

  function setDelayedFilter(next: boolean) {
    delayed.value = next;
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
    delayed,
    sortBy,
    sortDir,
    fetch,
    setStatusFilter,
    setDelayedFilter,
  };
}
