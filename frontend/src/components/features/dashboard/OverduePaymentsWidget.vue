<script setup lang="ts">
import { computed } from 'vue';
import { t } from '@/i18n';
import type { OverduePaymentsGroup } from '@/types/dashboard';
import DashboardSection from './DashboardSection.vue';
import OverduePaymentRow from './OverduePaymentRow.vue';
import EmptyState from '@/components/shared/EmptyState.vue';

const props = defineProps<{
  groups: OverduePaymentsGroup[];
  loading: boolean;
}>();

const top = computed(() => props.groups.slice(0, 5));
</script>

<template>
  <DashboardSection :title="t('dashboard.overdue.title')" icon="mdi-cash-remove">
    <template #action>
      <v-btn
        v-if="groups.length > 0"
        variant="text"
        size="small"
        append-icon="mdi-arrow-left"
        to="/payments?late=true"
      >
        {{ t('dashboard.viewAll') }}
      </v-btn>
    </template>

    <div v-if="loading && groups.length === 0" class="p-2">
      <v-skeleton-loader
        v-for="i in 3"
        :key="i"
        type="list-item-avatar-two-line"
        class="px-2"
      />
    </div>

    <div v-else-if="top.length > 0">
      <OverduePaymentRow v-for="g in top" :key="g.projectId" :group="g" />
    </div>

    <EmptyState
      v-else
      :title="t('dashboard.overdue.empty')"
      icon="mdi-check-circle-outline"
      compact
    />
  </DashboardSection>
</template>
