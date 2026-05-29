import { ref } from 'vue';
import { dashboardApi } from '@/services/api/dashboard.api';
import { ApiError } from '@/types/api';
import type {
  DashboardSummary,
  DelayedProjectRow,
  OverduePaymentsGroup,
} from '@/types/dashboard';

// Single fetch entry point that runs the three dashboard endpoints in
// parallel. Each individual list (delayed/overdue) is caught so a slow or
// failing list doesn't blank the main summary numbers.
export function useDashboard() {
  const summary = ref<DashboardSummary | null>(null);
  const delayed = ref<DelayedProjectRow[]>([]);
  const overdue = ref<OverduePaymentsGroup[]>([]);
  const loading = ref(false);
  const error = ref<ApiError | null>(null);

  async function fetch() {
    loading.value = true;
    error.value = null;
    try {
      const [s, d, o] = await Promise.all([
        dashboardApi.getSummary(),
        dashboardApi.getDelayedProjects().catch(() => [] as DelayedProjectRow[]),
        dashboardApi.getOverduePayments().catch(() => [] as OverduePaymentsGroup[]),
      ]);
      summary.value = s;
      delayed.value = d;
      overdue.value = o;
    } catch (e) {
      error.value = e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', String(e));
    } finally {
      loading.value = false;
    }
  }

  return { summary, delayed, overdue, loading, error, fetch };
}
