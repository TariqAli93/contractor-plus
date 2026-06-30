<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted } from 'vue';
import { t } from '@/i18n';
import { useDashboard } from '@/composables/useDashboard';
import { useAuthStore } from '@/stores/auth.store';
import TopSummaryCards from '@/components/features/dashboard/TopSummaryCards.vue';
import MonthlyFinancialSummary from '@/components/features/dashboard/MonthlyFinancialSummary.vue';
import DelayedProjectsWidget from '@/components/features/dashboard/DelayedProjectsWidget.vue';
import OverduePaymentsWidget from '@/components/features/dashboard/OverduePaymentsWidget.vue';
import RecentProjectsWidget from '@/components/features/dashboard/RecentProjectsWidget.vue';
import RecentPaymentsWidget from '@/components/features/dashboard/RecentPaymentsWidget.vue';
import QuickActionsPanel from '@/components/features/dashboard/QuickActionsPanel.vue';
import TunnelStatusWidget from '@/components/features/dashboard/TunnelStatusWidget.vue';
import ErrorState from '@/components/shared/ErrorState.vue';
import DateDisplay from '@/components/shared/DateDisplay.vue';

const auth = useAuthStore();
const { summary, delayed, overdue, loading, error, fetch } = useDashboard();

// Lazy-load the chart so ApexCharts (heavy) is split into its own async chunk,
// fetched only when the dashboard actually renders — keeping the route chunk lean.
const FinancialOverviewChart = defineAsyncComponent(
  () => import('@/components/features/dashboard/FinancialOverviewChart.vue'),
);

onMounted(fetch);

const greetingName = computed(() => auth.user?.fullName?.split(' ')[0] ?? '');
</script>

<template>
  <div class="cp-dashboard">
    <header class="cp-dashboard__header">
      <div class="min-w-0">
        <p class="cp-eyebrow mb-1">{{ t('nav.dashboard') }}</p>
        <h1 class="cp-dashboard__title">
          {{ t('auth.welcome') }}{{ greetingName ? ', ' + greetingName : '' }}
        </h1>
        <p v-if="summary" class="text-medium-emphasis text-sm mt-1">
          {{ t('dashboard.asOf') }} <DateDisplay :value="summary.asOf" />
        </p>
      </div>
      <v-btn
        variant="tonal"
        color="primary"
        prepend-icon="mdi-refresh"
        :loading="loading"
        @click="fetch"
      >
        {{ t('dashboard.refresh') }}
      </v-btn>
    </header>

    <ErrorState v-if="error" :error="error" class="my-6" @retry="fetch" />

    <template v-else>
      <TopSummaryCards :summary="summary" :loading="loading" class="mb-6" />

      <div class="cp-dashboard__grid">
        <div class="cp-dashboard__main">
          <section>
            <h2 class="cp-section-title mb-3 px-1">
              {{ t('dashboard.metrics.monthlyRevenue') }}
            </h2>
            <MonthlyFinancialSummary :summary="summary" :loading="loading" />
          </section>

          <FinancialOverviewChart :summary="summary" :loading="loading" />

          <DelayedProjectsWidget :projects="delayed" :loading="loading" />
          <OverduePaymentsWidget :groups="overdue" :loading="loading" />

          <div class="cp-dashboard__pair">
            <RecentProjectsWidget
              :projects="summary?.recentProjects ?? []"
              :loading="loading"
            />
            <RecentPaymentsWidget
              :payments="summary?.recentPayments ?? []"
              :loading="loading"
            />
          </div>
        </div>

        <aside class="cp-dashboard__side">
          <div class="cp-dashboard__sticky">
            <QuickActionsPanel />
            <TunnelStatusWidget />
          </div>
        </aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
.cp-dashboard__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 24px;
}
.cp-dashboard__title {
  font-size: 1.75rem;
  font-weight: 600;
  letter-spacing: -0.025em;
  line-height: 1.15;
  color: var(--cp-text);
}

.cp-dashboard__grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 24px;
}
@media (min-width: 1100px) {
  .cp-dashboard__grid {
    grid-template-columns: minmax(0, 1fr) 320px;
  }
}

.cp-dashboard__main {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
}

.cp-dashboard__pair {
  display: grid;
  grid-template-columns: 1fr;
  gap: 20px;
}
@media (min-width: 768px) {
  .cp-dashboard__pair {
    grid-template-columns: 1fr 1fr;
  }
}

.cp-dashboard__side {
  min-width: 0;
}
.cp-dashboard__sticky {
  display: flex;
  flex-direction: column;
  gap: 20px;
  position: sticky;
  top: 88px;
}
</style>
