<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import type { OverduePaymentsGroup } from '@/types/dashboard';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';
import DateDisplay from '@/components/shared/DateDisplay.vue';

const props = defineProps<{ group: OverduePaymentsGroup }>();
const router = useRouter();
const { t } = useI18n();

function open() {
  void router.push(`/projects/${props.group.projectId}`);
}
</script>

<template>
  <button type="button" class="cp-row-button" @click="open">
    <div class="flex items-center gap-3 flex-wrap">
      <span class="cp-icon-tile cp-icon-tile--error">
        <v-icon icon="mdi-cash-remove" size="18" />
      </span>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 mb-1">
          <span class="font-medium truncate">{{ group.projectName }}</span>
          <v-chip
            v-if="group.overduePaymentsCount > 1"
            size="x-small"
            variant="tonal"
          >
            {{ t('dashboard.overdue.invoiceCount', { n: group.overduePaymentsCount }) }}
          </v-chip>
        </div>
        <div
          class="text-caption text-medium-emphasis flex items-center gap-x-2 flex-wrap"
        >
          <span v-if="group.customerName" class="truncate">{{ group.customerName }}</span>
          <span v-if="group.contractNumber" aria-hidden="true">·</span>
          <span v-if="group.contractNumber" class="truncate">{{ group.contractNumber }}</span>
          <span aria-hidden="true">·</span>
          <span class="inline-flex items-center gap-1 text-error">
            <v-icon icon="mdi-clock-alert-outline" size="14" />
            <DateDisplay :value="group.oldestDueDate" />
          </span>
        </div>
      </div>
      <div class="text-error font-semibold tabular-nums">
        <MoneyDisplay :amount="group.totalOverdueAmount" />
      </div>
    </div>
  </button>
</template>
