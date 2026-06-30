<script setup lang="ts">
import { computed } from 'vue';
import { t } from '@/i18n';
import { useCurrencyFormat } from '@/composables/useCurrencyFormat';
import type { ContractWithRelations } from '@/types/contract';
import { ContractStatus } from '@/types/enums';
import type { GridColumn, GridRow } from '@/components/shared/datagrid/types';
import DataGrid from '@/components/shared/datagrid/DataGrid.vue';
import { buildContractItemColumns } from './contractItemColumns';
import EmptyState from '@/components/shared/EmptyState.vue';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';

const props = defineProps<{ contract: ContractWithRelations }>();
const { format: money } = useCurrencyFormat();

const totalCost = computed(() =>
  props.contract.items.reduce((s, i) => s + Number(i.estimatedPrice), 0),
);

const columns = computed<GridColumn[]>(() => buildContractItemColumns({ t, money }));
const gridRows = computed<GridRow[]>(() => props.contract.items as unknown as GridRow[]);

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

    <template v-if="contract.items.length > 0">
      <DataGrid
        :rows="gridRows"
        :columns="columns"
        :editable="false"
        :enable-csv="true"
        export-name="contract-items"
        height="440px"
      />
      <div class="flex items-center justify-end gap-3 mt-3 pe-2">
        <span class="font-medium">{{ t('contracts.items.totalEstimated') }}</span>
        <span class="font-medium text-h6"><MoneyDisplay :amount="totalCost" /></span>
      </div>
    </template>

    <EmptyState
      v-else
      :title="t('contracts.items.empty')"
      icon="mdi-package-variant"
    />
  </div>
</template>
