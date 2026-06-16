<script setup lang="ts">
import { onMounted } from 'vue';
import { t } from '@/i18n';
import { useTemplateEstimate } from '@/composables/useTemplateEstimate';
import SummaryCard from '@/components/shared/SummaryCard.vue';
import ErrorState from '@/components/shared/ErrorState.vue';
import EmptyState from '@/components/shared/EmptyState.vue';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';

const props = defineProps<{ templateId: string }>();

const { data, loading, error, fetch } = useTemplateEstimate(props.templateId);

onMounted(fetch);
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-h6">{{ t('templates.estimate.title') }}</h2>
      <v-btn
        variant="tonal"
        prepend-icon="mdi-refresh"
        :loading="loading"
        @click="fetch"
      >
        {{ t('common.retry') }}
      </v-btn>
    </div>

    <ErrorState v-if="error" :error="error" class="my-4" @retry="fetch" />

    <template v-else-if="data">
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <SummaryCard
          :title="t('templates.estimate.fields.materialCost')"
          icon="mdi-cube-outline"
          :loading="loading"
        >
          <MoneyDisplay :amount="data.estimatedMaterialCost" />
        </SummaryCard>
        <SummaryCard
          :title="t('templates.estimate.fields.profitMargin')"
          icon="mdi-chart-line"
          :loading="loading"
        >
          {{ data.suggestedProfitMargin !== null ? `${data.suggestedProfitMargin}%` : '—' }}
        </SummaryCard>
        <SummaryCard
          :title="t('templates.estimate.fields.profitAmount')"
          icon="mdi-cash-plus"
          :loading="loading"
        >
          <MoneyDisplay :amount="data.estimatedProfitAmount" />
        </SummaryCard>
        <SummaryCard
          :title="t('templates.estimate.fields.sellingPrice')"
          icon="mdi-tag-outline"
          :loading="loading"
        >
          <MoneyDisplay :amount="data.estimatedSellingPrice" />
        </SummaryCard>
        <SummaryCard
          :title="t('templates.estimate.fields.durationDays')"
          icon="mdi-calendar-clock"
          :loading="loading"
        >
          {{ data.estimatedDurationDays ?? '—' }}
        </SummaryCard>
        <SummaryCard
          :title="t('templates.estimate.fields.stepsPercentage')"
          icon="mdi-percent-outline"
          :loading="loading"
        >
          {{ data.summary.totalStepsPercentage }}%
        </SummaryCard>
        <SummaryCard
          :title="t('templates.estimate.fields.itemCount')"
          icon="mdi-format-list-bulleted"
          :loading="loading"
        >
          {{ data.summary.itemCount }}
        </SummaryCard>
        <SummaryCard
          :title="t('templates.estimate.fields.stepCount')"
          icon="mdi-format-list-numbered"
          :loading="loading"
        >
          {{ data.summary.stepCount }}
        </SummaryCard>
      </div>

      <v-card variant="outlined" class="mb-4">
        <v-card-title class="text-h6">{{ t('templates.estimate.materialsBreakdown') }}</v-card-title>
        <v-divider />
        <v-table density="comfortable">
          <thead>
            <tr>
              <th class="text-start">{{ t('templates.items.fields.material') }}</th>
              <th class="text-start" style="width: 90px">{{ t('templates.items.fields.unit') }}</th>
              <th class="text-end" style="width: 180px">{{ t('templates.items.fields.quantityPer100m2') }}</th>
              <th class="text-end" style="width: 160px">{{ t('templates.items.fields.estimatedPrice') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in data.materials" :key="m.itemId">
              <td>{{ m.materialName }}</td>
              <td>{{ m.unit }}</td>
              <td class="text-end">{{ m.estimatedQuantity }}</td>
              <td class="text-end"><MoneyDisplay :amount="m.estimatedPrice" /></td>
            </tr>
          </tbody>
        </v-table>
        <EmptyState
          v-if="data.materials.length === 0"
          :title="t('templates.items.empty')"
          icon="mdi-package-variant"
        />
      </v-card>

      <v-card variant="outlined">
        <v-card-title class="text-h6">{{ t('templates.estimate.stepsSummary') }}</v-card-title>
        <v-divider />
        <v-table density="comfortable">
          <thead>
            <tr>
              <th class="text-end" style="width: 90px">{{ t('templates.steps.fields.sortOrder') }}</th>
              <th class="text-start">{{ t('templates.steps.fields.name') }}</th>
              <th class="text-end" style="width: 130px">{{ t('templates.steps.fields.percentage') }}</th>
              <th class="text-end" style="width: 130px">{{ t('templates.steps.fields.estimatedDays') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in data.steps" :key="s.id">
              <td class="text-end">{{ s.sortOrder }}</td>
              <td>{{ s.name }}</td>
              <td class="text-end">{{ s.percentage }}%</td>
              <td class="text-end">{{ s.estimatedDays ?? '—' }}</td>
            </tr>
          </tbody>
        </v-table>
        <EmptyState
          v-if="data.steps.length === 0"
          :title="t('templates.steps.empty')"
          icon="mdi-format-list-numbered"
        />
      </v-card>
    </template>

    <v-progress-linear v-else indeterminate />
  </div>
</template>
