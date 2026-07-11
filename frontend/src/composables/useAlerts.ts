import { computed, ref } from 'vue';
import { t } from '@/i18n';
import { reportsApi } from '@/services/api/reports.api';
import { useCurrencyFormat } from '@/composables/useCurrencyFormat';

// Cross-page actionable alerts, aggregated from EXISTING report endpoints
// (delayed projects + overdue payments) - no new backend. Surfaced by the
// topbar NotificationsBell. Each alert links to the relevant project.
export interface AlertItem {
  id: string;
  kind: 'delayed' | 'overdue';
  title: string;
  subtitle: string;
  to: string;
  severity: 'error' | 'warning';
}

export function useAlerts() {
  const { format: money } = useCurrencyFormat();
  const items = ref<AlertItem[]>([]);
  const loading = ref(false);
  const loaded = ref(false);

  async function refresh() {
    loading.value = true;
    try {
      // Each endpoint is independently permission-gated; a 403 for this role
      // just yields no alerts of that kind rather than failing the whole bell.
      const [delayed, overdue] = await Promise.all([
        reportsApi.delayedProjects().catch(() => []),
        reportsApi.overduePayments().catch(() => []),
      ]);
      const list: AlertItem[] = [];
      for (const o of overdue) {
        list.push({
          id: `o-${o.projectId}`,
          kind: 'overdue',
          title: o.projectName,
          subtitle: `${t('alerts.overdueCount').replace('{n}', String(o.overduePaymentsCount))} · ${money(o.totalOverdueAmount)}`,
          to: `/projects/${o.projectId}`,
          severity: 'error',
        });
      }
      for (const d of delayed) {
        list.push({
          id: `d-${d.projectId}`,
          kind: 'delayed',
          title: d.name,
          subtitle: t('alerts.delayedBy').replace('{n}', String(d.daysDelayed)),
          to: `/projects/${d.projectId}`,
          severity: 'warning',
        });
      }
      items.value = list;
    } finally {
      loading.value = false;
      loaded.value = true;
    }
  }

  const count = computed(() => items.value.length);
  return { items, count, loading, loaded, refresh };
}
