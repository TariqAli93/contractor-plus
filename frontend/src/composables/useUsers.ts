import { ref, watch } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import { usersApi } from '@/services/api/users.api';
import { ApiError } from '@/types/api';
import type { RoleName } from '@/types/enums';
import type { User } from '@/types/user';

// List-page state for /users: pagination + sort + search + role/active filters,
// with debounced search and auto-refetch on any input change.
export function useUsers() {
  const items = ref<User[]>([]);
  const total = ref(0);
  const loading = ref(false);
  const error = ref<ApiError | null>(null);

  const page = ref(1);
  const pageSize = ref(20);
  const search = ref('');
  const roleFilter = ref<RoleName | null>(null);
  const activeFilter = ref<boolean | null>(null);
  const sortBy = ref<'username' | 'fullName' | 'createdAt' | 'lastLoginAt'>('createdAt');
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
      const res = await usersApi.list({
        page: page.value,
        pageSize: pageSize.value,
        search: search.value || undefined,
        role: roleFilter.value ?? undefined,
        isActive: activeFilter.value ?? undefined,
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

  watch([page, pageSize, search, roleFilter, activeFilter, sortBy, sortDir], () => {
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
    roleFilter,
    activeFilter,
    sortBy,
    sortDir,
    fetch,
  };
}
