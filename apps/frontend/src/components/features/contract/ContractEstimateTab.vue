<script setup lang="ts">
import { computed } from 'vue';
import { t } from '@/i18n';
import { useContractEstimate } from '@/composables/useContractEstimate';
import { useConfirm } from '@/composables/useConfirm';
import { useToast } from '@/composables/useToast';
import { useApiError } from '@/composables/useApiError';
import { ContractStatus } from '@/types/enums';
import type { ContractWithRelations } from '@/types/contract';
import SummaryCard from '@/components/shared/SummaryCard.vue';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';
import ErrorState from '@/components/shared/ErrorState.vue';

const props = defineProps<{ contract: ContractWithRelations }>();
const emit = defineEmits<{ refetch: [] }>();

const { confirm } = useConfirm();
const toast = useToast();
const { handle } = useApiError();

const { result, generating, error, generate } = useContractEstimate(props.contract.id);

const canGenerate = computed(
  () => props.contract.status === ContractStatus.DRAFT && !!props.contract.templateId,
);

const blockedReason = computed(() => {
  if (props.contract.status === ContractStatus.APPROVED) return t('contracts.estimate.lockedApproved');
  if (props.contract.status === ContractStatus.CANCELLED) return t('contracts.estimate.lockedCancelled');
  if (!props.contract.templateId) return t('contracts.estimate.noTemplate');
  return null;
});

async function runGenerate() {
  if (props.contract.items.length > 0) {
    const ok = await confirm({
      title: t('contracts.dialogs.regenerateTitle'),
      message: t('contracts.dialogs.regenerateMessage'),
      confirmText: t('contracts.actions.generateEstimate'),
      destructive: true,
    });
    if (!ok) return;
  }
  const ok = await generate();
  if (ok) {
    toast.success(t('contracts.toasts.estimateGenerated'));
    emit('refetch');
  } else if (error.value) {
    handle(error.value);
  }
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-3 gap-3 flex-wrap">
      <h2 class="text-h6">{{ t('contracts.estimate.title') }}</h2>
      <v-btn
        color="primary"
        variant="tonal"
        prepend-icon="mdi-calculator-variant-outline"
        :disabled="!canGenerate"
        :loading="generating"
        @click="runGenerate"
      >
        {{ t('contracts.actions.generateEstimate') }}
      </v-btn>
    </div>

    <v-alert
      v-if="blockedReason"
      type="info"
      variant="tonal"
      density="comfortable"
      class="mb-3"
    >
      {{ blockedReason }}
    </v-alert>

    <ErrorState v-if="error" :error="error" class="my-4" @retry="runGenerate" />

    <template v-if="result">
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <SummaryCard
          :title="t('contracts.estimate.fields.materialCost')"
          icon="mdi-cube-outline"
        >
          <MoneyDisplay :amount="result.estimatedMaterialCost" />
        </SummaryCard>
        <SummaryCard
          :title="t('contracts.estimate.fields.profitMargin')"
          icon="mdi-percent-outline"
        >
          {{ result.expectedProfitMargin !== null ? `${result.expectedProfitMargin}%` : '—' }}
        </SummaryCard>
        <SummaryCard
          :title="t('contracts.estimate.fields.profitAmount')"
          icon="mdi-cash-plus"
        >
          <MoneyDisplay :amount="result.estimatedProfitAmount" />
        </SummaryCard>
        <SummaryCard
          :title="t('contracts.estimate.fields.suggestedSellingPrice')"
          icon="mdi-tag-outline"
        >
          <MoneyDisplay :amount="result.suggestedSellingPrice" />
        </SummaryCard>
        <SummaryCard
          :title="t('contracts.estimate.fields.suggestedMeterPrice')"
          icon="mdi-ruler"
        >
          <MoneyDisplay :amount="result.suggestedMeterPrice" />
        </SummaryCard>
        <SummaryCard
          :title="t('contracts.estimate.fields.currentTotalPrice')"
          icon="mdi-cash"
        >
          <MoneyDisplay :amount="result.currentTotalPrice" />
        </SummaryCard>
        <SummaryCard
          :title="t('contracts.estimate.fields.scaleFactor')"
          icon="mdi-resize"
        >
          {{ result.scaleFactor }}×
        </SummaryCard>
        <SummaryCard
          :title="t('contracts.estimate.fields.itemsReplaced')"
          icon="mdi-package-variant"
        >
          {{ result.itemsReplaced }}
        </SummaryCard>
      </div>

      <v-alert
        v-if="result.suggestedMeterPrice !== null && result.suggestedMeterPrice !== result.currentMeterPrice"
        type="info"
        variant="tonal"
        icon="mdi-information-outline"
      >
        {{ t('contracts.estimate.priceDiverged', {
          current: result.currentMeterPrice,
          suggested: result.suggestedMeterPrice,
        }) }}
      </v-alert>
    </template>

    <v-card v-else-if="!error && !generating" variant="outlined" class="text-center pa-8">
      <v-icon icon="mdi-calculator-variant-outline" size="48" class="text-medium-emphasis" />
      <div class="text-h6 mt-2">{{ t('contracts.estimate.empty') }}</div>
      <div class="text-medium-emphasis text-sm mt-1">{{ t('contracts.estimate.emptyHint') }}</div>
    </v-card>
  </div>
</template>
