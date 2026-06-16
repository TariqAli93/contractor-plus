<script setup lang="ts">
import { computed } from 'vue';
import { t } from '@/i18n';
import type { ContractWithRelations } from '@/types/contract';
import { ContractStatus } from '@/types/enums';
import EmptyState from '@/components/shared/EmptyState.vue';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';
import ContractItemRow from './ContractItemRow.vue';

const props = defineProps<{ contract: ContractWithRelations }>();

const totalCost = computed(() =>
  props.contract.items.reduce((s, i) => s + Number(i.estimatedPrice), 0),
);

const explanation = computed(() => {
  if (props.contract.status === ContractStatus.CANCELLED) return t('contracts.items.cancelledHint');
  if (!props.contract.templateId) return t('contracts.items.noTemplateHint');
  if (props.contract.items.length === 0) return t('contracts.items.emptyHint');
  return null;
});
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-3 gap-3 flex-wrap">
      <h2 class="text-h6">{{ t('contracts.items.title') }}</h2>
      <div class="text-medium-emphasis text-sm">
        {{ t('contracts.items.readOnlyHint') }}
      </div>
    </div>

    <v-alert
      v-if="explanation"
      type="info"
      variant="tonal"
      density="comfortable"
      class="mb-3"
    >
      {{ explanation }}
    </v-alert>

    <v-table v-if="contract.items.length > 0" density="comfortable">
      <thead>
        <tr>
          <th class="text-start">{{ t('contracts.items.fields.material') }}</th>
          <th class="text-start" style="width: 90px">{{ t('contracts.items.fields.unit') }}</th>
          <th class="text-end" style="width: 140px">{{ t('contracts.items.fields.quantity') }}</th>
          <th class="text-end" style="width: 160px">{{ t('contracts.items.fields.estimatedPrice') }}</th>
          <th class="text-start">{{ t('contracts.items.fields.notes') }}</th>
        </tr>
      </thead>
      <tbody>
        <ContractItemRow v-for="item in contract.items" :key="item.id" :item="item" />
      </tbody>
      <tfoot>
        <tr>
          <td colspan="3" class="text-end font-medium">{{ t('contracts.items.totalEstimated') }}</td>
          <td class="text-end font-medium"><MoneyDisplay :amount="totalCost" /></td>
          <td></td>
        </tr>
      </tfoot>
    </v-table>

    <EmptyState
      v-else
      :title="t('contracts.items.empty')"
      icon="mdi-package-variant"
    />
  </div>
</template>
