<script setup lang="ts">
import { t } from '@/i18n';
import PageHeader from '@/components/shared/PageHeader.vue';

interface ReportRow {
  to: string;
  icon: string;
  titleKey: string;
  descKey: string;
}

const reports: ReportRow[] = [
  { to: '/reports/project-profitability', icon: 'mdi-chart-bar', titleKey: 'reports.cards.profitability.title', descKey: 'reports.cards.profitability.desc' },
  { to: '/reports/cash-flow', icon: 'mdi-cash-multiple', titleKey: 'reports.cards.cashFlow.title', descKey: 'reports.cards.cashFlow.desc' },
  { to: '/reports/overdue-payments', icon: 'mdi-alert-circle-outline', titleKey: 'reports.cards.overdue.title', descKey: 'reports.cards.overdue.desc' },
  { to: '/reports/delayed-projects', icon: 'mdi-clock-alert-outline', titleKey: 'reports.cards.delayed.title', descKey: 'reports.cards.delayed.desc' },
];
</script>

<template>
  <div class="cp-reports cp-fill">
    <PageHeader :title="t('nav.reports')" icon="mdi-chart-box-outline" :hint="t('help.reports')" />
    <section class="cp-panel cp-reports__panel">
      <div class="cp-reports__caption">{{ t('reports.subtitle') }}</div>
      <v-table fixed-header class="cp-reports__table">
        <thead>
          <tr>
            <th>{{ t('nav.reports') }}</th>
            <th>{{ t('common.details') }}</th>
            <th class="text-end">{{ t('common.open') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="report in reports" :key="report.to">
            <td>
              <RouterLink :to="report.to" class="cp-reports__link">
                <v-icon :icon="report.icon" size="17" />
                <span>{{ t(report.titleKey) }}</span>
              </RouterLink>
            </td>
            <td class="cp-reports__desc">{{ t(report.descKey) }}</td>
            <td class="text-end">
              <v-btn :to="report.to" variant="text" size="x-small" append-icon="mdi-arrow-left">
                {{ t('common.open') }}
              </v-btn>
            </td>
          </tr>
        </tbody>
      </v-table>
    </section>
  </div>
</template>

<style scoped>
.cp-reports {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
.cp-reports__panel {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.cp-reports__caption {
  min-height: 28px;
  padding: 5px 8px;
  font-size: 0.76rem;
  color: var(--cp-text-muted);
  background: var(--cp-surface-2);
  border-block-end: 1px solid var(--cp-border);
}
.cp-reports__table {
  height: calc(100% - 28px);
}
.cp-reports__link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--cp-primary);
  font-weight: 600;
  text-decoration: none;
}
.cp-reports__link:hover {
  color: var(--cp-primary-hover);
  text-decoration: underline;
}
.cp-reports__desc {
  color: var(--cp-text-muted);
}
</style>
