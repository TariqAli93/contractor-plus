<script setup lang="ts">
import { computed } from 'vue';
import { t } from '@/i18n';
import type { DashboardRecentPayment } from '@/types/dashboard';
import DashboardSection from './DashboardSection.vue';
import RecentPaymentRow from './RecentPaymentRow.vue';
import EmptyState from '@/components/shared/EmptyState.vue';

const props = defineProps<{
  payments: DashboardRecentPayment[];
  loading: boolean;
}>();

const top = computed(() => props.payments.slice(0, 5));
</script>

<template>
  <DashboardSection :title="t('dashboard.recent.payments')" icon="mdi-cash-plus">
    <template #action>
      <v-btn variant="text" size="small" append-icon="mdi-arrow-left" to="/payments">
        {{ t('dashboard.viewAll') }}
      </v-btn>
    </template>

    <div v-if="loading && payments.length === 0" class="p-2">
      <v-skeleton-loader
        v-for="i in 3"
        :key="i"
        type="list-item-avatar-two-line"
        class="px-2"
      />
    </div>

    <div v-else-if="top.length > 0">
      <RecentPaymentRow v-for="p in top" :key="p.id" :payment="p" />
    </div>

    <EmptyState
      v-else
      :title="t('dashboard.recent.empty')"
      icon="mdi-cash-multiple"
      compact
    />
  </DashboardSection>
</template>
