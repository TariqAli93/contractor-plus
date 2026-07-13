<script setup lang="ts">
import { defineAsyncComponent, onMounted } from 'vue';
import { t } from '@/i18n';
import { useDashboard } from '@/composables/useDashboard';
import TopSummaryCards from '@/components/features/dashboard/TopSummaryCards.vue';
import MonthlyFinancialSummary from '@/components/features/dashboard/MonthlyFinancialSummary.vue';
import DelayedProjectsWidget from '@/components/features/dashboard/DelayedProjectsWidget.vue';
import OverduePaymentsWidget from '@/components/features/dashboard/OverduePaymentsWidget.vue';
import AiRecommendationsWidget from '@/components/features/dashboard/AiRecommendationsWidget.vue';
import RecentProjectsWidget from '@/components/features/dashboard/RecentProjectsWidget.vue';
import RecentPaymentsWidget from '@/components/features/dashboard/RecentPaymentsWidget.vue';
import QuickActionsPanel from '@/components/features/dashboard/QuickActionsPanel.vue';
import TunnelStatusWidget from '@/components/features/dashboard/TunnelStatusWidget.vue';
import ErrorState from '@/components/shared/ErrorState.vue';
import DateDisplay from '@/components/shared/DateDisplay.vue';
import PageHeader from '@/components/shared/PageHeader.vue';

const { summary, delayed, overdue, loading, error, fetch } = useDashboard();

// Lazy-load the chart so ApexCharts (heavy) is split into its own async chunk,
// fetched only when the dashboard actually renders - keeping the route chunk lean.
const FinancialOverviewChart = defineAsyncComponent(
  () => import('@/components/features/dashboard/FinancialOverviewChart.vue'),
);

onMounted(fetch);

</script>

<template>
  <div class="cp-dashboard">
    <PageHeader :title="t('nav.dashboard')" icon="mdi-view-dashboard-outline">
      <v-btn
        variant="outlined"
        color="primary"
        prepend-icon="mdi-refresh"
        :loading="loading"
        @click="fetch"
      >
        {{ t('dashboard.refresh') }}
      </v-btn>
    </PageHeader>
    <div v-if="summary" class="cp-dashboard__context">
      {{ t('dashboard.asOf') }} <DateDisplay :value="summary.asOf" />
    </div>

    <ErrorState v-if="error" :error="error" class="my-2" @retry="fetch" />

    <template v-else>
      <TopSummaryCards :summary="summary" :loading="loading" class="cp-dashboard__metrics" />

      <div class="cp-dashboard__grid">
        <div class="cp-dashboard__main">
          <section class="cp-dashboard__month">
            <h2 class="cp-section-title">
              {{ t('dashboard.metrics.monthlyRevenue') }}
            </h2>
            <MonthlyFinancialSummary :summary="summary" :loading="loading" />
          </section>

          <FinancialOverviewChart :summary="summary" :loading="loading" />

          <AiRecommendationsWidget />
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
.cp-dashboard__context {
  min-height: 22px;
  padding: 3px 8px;
  margin-bottom: 6px;
  font-size: 0.74rem;
  color: var(--cp-text-muted);
  background: var(--cp-panel);
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius-sm);
}
.cp-dashboard__metrics {
  margin-bottom: 6px;
}
.cp-dashboard__month {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cp-dashboard__grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 6px;
}
@media (min-width: 1100px) {
  .cp-dashboard__grid {
    grid-template-columns: minmax(0, 1fr) 320px;
  }
}

.cp-dashboard__main {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.cp-dashboard__pair {
  display: grid;
  grid-template-columns: 1fr;
  gap: 6px;
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
  gap: 6px;
  position: sticky;
  top: 6px;
}
</style>
