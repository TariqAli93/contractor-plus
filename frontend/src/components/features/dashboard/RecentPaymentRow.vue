<script setup lang="ts">
import { useRouter } from 'vue-router';
import type { DashboardRecentPayment } from '@/types/dashboard';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';
import DateDisplay from '@/components/shared/DateDisplay.vue';

const props = defineProps<{ payment: DashboardRecentPayment }>();
const router = useRouter();

function open() {
  void router.push(`/projects/${props.payment.projectId}`);
}
</script>

<template>
  <button type="button" class="cp-row-button" @click="open">
    <div class="flex items-center gap-3">
      <span class="cp-icon-tile cp-icon-tile--success">
        <v-icon icon="mdi-check" size="18" />
      </span>
      <div class="min-w-0 flex-1">
        <div class="flex items-center justify-between gap-2">
          <div class="font-medium tabular-nums">
            <MoneyDisplay :amount="payment.amount" />
          </div>
          <v-chip size="x-small" color="success" variant="tonal">{{ payment.status }}</v-chip>
        </div>
        <div
          class="text-caption text-medium-emphasis flex items-center gap-x-2 flex-wrap mt-0.5"
        >
          <DateDisplay :value="payment.paymentDate ?? payment.dueDate" />
          <template v-if="payment.method">
            <span aria-hidden="true">·</span>
            <span>{{ payment.method }}</span>
          </template>
          <template v-if="payment.reference">
            <span aria-hidden="true">·</span>
            <span class="truncate">{{ payment.reference }}</span>
          </template>
        </div>
      </div>
    </div>
  </button>
</template>
