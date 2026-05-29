import { ref, watch } from 'vue';
import { auditApi } from '@/services/api/audit.api';
import { ApiError } from '@/types/api';
import type { AuditLog } from '@/types/audit';
import type { AuditAction } from '@/types/enums';

export function useAuditLogs() {
  const items = ref<AuditLog[]>([]);
  const total = ref(0);
  const loading = ref(false);
  const error = ref<ApiError | null>(null);

  const page = ref(1);
  const pageSize = ref(20);
  const entity = ref<string | undefined>(undefined);
  const entityId = ref<string | undefined>(undefined);
  const action = ref<AuditAction | undefined>(undefined);
  const userId = ref<string | undefined>(undefined);
  const dateFrom = ref<string | undefined>(undefined);
  const dateTo = ref<string | undefined>(undefined);
  const sortDir = ref<'asc' | 'desc'>('desc');

  async function fetch() {
    loading.value = true;
    error.value = null;
    try {
      const res = await auditApi.listLogs({
        page: page.value,
        pageSize: pageSize.value,
        entity: entity.value,
        entityId: entityId.value,
        action: action.value,
        userId: userId.value,
        dateFrom: dateFrom.value,
        dateTo: dateTo.value,
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
    [page, pageSize, entity, entityId, action, userId, dateFrom, dateTo, sortDir],
    () => void fetch(),
  );

  return {
    items,
    total,
    loading,
    error,
    page,
    pageSize,
    entity,
    entityId,
    action,
    userId,
    dateFrom,
    dateTo,
    sortDir,
    fetch,
  };
}
