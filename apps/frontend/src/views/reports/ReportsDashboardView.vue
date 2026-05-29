<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

// Hub page — links to the four detail reports. The home dashboard already
// surfaces the summary cards; this page is a navigable index.
interface ReportCard {
  to: string;
  icon: string;
  titleKey: string;
  descKey: string;
}

const cards: ReportCard[] = [
  {
    to: '/reports/project-profitability',
    icon: 'mdi-chart-bar',
    titleKey: 'reports.cards.profitability.title',
    descKey: 'reports.cards.profitability.desc',
  },
  {
    to: '/reports/cash-flow',
    icon: 'mdi-cash-multiple',
    titleKey: 'reports.cards.cashFlow.title',
    descKey: 'reports.cards.cashFlow.desc',
  },
  {
    to: '/reports/overdue-payments',
    icon: 'mdi-alert-circle-outline',
    titleKey: 'reports.cards.overdue.title',
    descKey: 'reports.cards.overdue.desc',
  },
  {
    to: '/reports/delayed-projects',
    icon: 'mdi-clock-alert-outline',
    titleKey: 'reports.cards.delayed.title',
    descKey: 'reports.cards.delayed.desc',
  },
];
</script>

<template>
  <div>
    <div class="mb-4">
      <h1 class="text-h5 mb-1">{{ t('nav.reports') }}</h1>
      <p class="text-body-2 text-medium-emphasis mb-0">{{ t('reports.subtitle') }}</p>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <RouterLink v-for="c in cards" :key="c.to" :to="c.to" class="no-underline">
        <v-card hover class="h-full">
          <v-card-text class="flex items-start gap-4">
            <v-icon :icon="c.icon" size="32" class="text-primary mt-1" />
            <div class="flex-1">
              <div class="text-subtitle-1 font-medium mb-1">{{ t(c.titleKey) }}</div>
              <p class="text-body-2 text-medium-emphasis mb-0">{{ t(c.descKey) }}</p>
            </div>
            <v-icon icon="mdi-arrow-left" class="text-medium-emphasis" />
          </v-card-text>
        </v-card>
      </RouterLink>
    </div>
  </div>
</template>
