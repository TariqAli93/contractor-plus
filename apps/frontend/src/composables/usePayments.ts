import { ref, watch } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import { paymentsApi } from '@/services/api/payments.api';
import { ApiError } from '@/types/api';
import type { Payment } from '@/types/payment';
import type { PaymentStatus } from '@/types/enums';

export function usePayments() {
  const items = ref<Payment[]>([]);
  const total = ref(0);
  const loading = ref(false);
  const error = ref<ApiError | null>(null);

  const page = ref(1);
  const pageSize = ref(20);
  const search = ref('');
  const projectId = ref<string | undefined>(undefined);
  const status = ref<PaymentStatus | undefined>(undefined);
  const late = ref<boolean>(false);
  const dueDateFrom = ref<string | undefined>(undefined);
  const dueDateTo = ref<string | undefined>(undefined);
  const sortBy = ref<'dueDate' | 'amount' | 'createdAt' | 'paymentDate'>('dueDate');
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
      const res = await paymentsApi.list({
        page: page.value,
        pageSize: pageSize.value,
        search: search.value || undefined,
        projectId: projectId.value,
        status: status.value,
        late: late.value || undefined,
        dueDateFrom: dueDateFrom.value,
        dueDateTo: dueDateTo.value,
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
    [page, pageSize, search, projectId, status, late, dueDateFrom, dueDateTo, sortBy, sortDir],
    () => {
      void fetch();
    },
  );

  function setProjectFilter(id: string | undefined) {
    projectId.value = id;
    page.value = 1;
  }

  function setStatusFilter(s: PaymentStatus | undefined) {
    status.value = s;
    page.value = 1;
  }

  function setLateFilter(v: boolean) {
    late.value = v;
    page.value = 1;
  }

  function setDueDateRange(from: string | undefined, to: string | undefined) {
    dueDateFrom.value = from;
    dueDateTo.value = to;
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
    status,
    late,
    dueDateFrom,
    dueDateTo,
    sortBy,
    sortDir,
    fetch,
    setProjectFilter,
    setStatusFilter,
    setLateFilter,
    setDueDateRange,
  };
}
