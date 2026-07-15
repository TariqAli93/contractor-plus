<script setup lang="ts">
// Read-only contract line-items: the backend has no per-item CRUD (items come
// from the template / estimate), so this is a plain native table with a total.
import { computed } from 'vue';
import { t } from '@/i18n';
import { useCurrencyFormat } from '@/composables/useCurrencyFormat';
import type { ContractWithRelations } from '@/types/contract';
import { ContractStatus } from '@/types/enums';
import DataTable from '@/components/shared/DataTable.vue';
import EmptyState from '@/components/shared/EmptyState.vue';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';

const props = defineProps<{ contract: ContractWithRelations }>();
const { format: money } = useCurrencyFormat();

const headers = computed(() => [
  { title: t('contracts.items.fields.material'), key: 'materialName', minWidth: 220 },
  { title: t('contracts.items.fields.unit'), key: 'unit', width: 100 },
  { title: t('contracts.items.fields.quantity'), key: 'quantity', align: 'end', width: 130 },
  { title: t('contracts.items.fields.estimatedPrice'), key: 'estimatedPrice', align: 'end', width: 160 },
  { title: t('contracts.items.fields.notes'), key: 'notes', minWidth: 160 },
]);

// Flatten the nested material name so the column sorts and renders plainly.
const items = computed(() =>
  props.contract.items.map((i) => ({
    ...i,
    materialName: (i.material as { name?: string } | null)?.name ?? '',
  })),
);

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
      <div class="text-medium-emphasis text-sm">{{ t('contracts.items.readOnlyHint') }}</div>
    </div>

    <v-alert v-if="explanation" type="info" variant="tonal" density="comfortable" class="mb-3">
      {{ explanation }}
    </v-alert>

    <template v-if="contract.items.length > 0">
      <DataTable
        :server="false"
        :items="items"
        :items-length="items.length"
        :headers="headers"
        item-value="id"
        :items-per-page="-1"
        hide-default-footer
        :aria-label="t('contracts.items.title')"
      >
        <template #[`item.quantity`]="{ item }">
          <span class="cp-num">{{ item.quantity }}</span>
        </template>
        <template #[`item.estimatedPrice`]="{ item }">
          <span class="cp-num">{{ money(Number(item.estimatedPrice)) }}</span>
        </template>
        <template #[`item.notes`]="{ item }">{{ item.notes || '-' }}</template>
      </DataTable>

      <div class="flex items-center justify-end gap-3 mt-3 pe-2">
        <span class="font-medium">{{ t('contracts.items.totalEstimated') }}</span>
        <span class="font-medium text-h6"><MoneyDisplay :amount="totalCost" /></span>
      </div>
    </template>

    <EmptyState v-else :title="t('contracts.items.empty')" icon="mdi-package-variant" />
  </div>
</template>

<style scoped>
.cp-num {
  font-variant-numeric: tabular-nums;
}
</style>
