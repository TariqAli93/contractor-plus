<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { t } from '@/i18n';
import { estimationTemplatesApi } from '@/services/api/estimationTemplates.api';
import { useApiError } from '@/composables/useApiError';
import PageHeader from '@/components/shared/PageHeader.vue';
import ErrorState from '@/components/shared/ErrorState.vue';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';
import type { EstimationTemplateView } from '@contractor-plus/shared';

const route = useRoute();
const { handle } = useApiError();

const template = ref<EstimationTemplateView | null>(null);
const loading = ref(false);
const error = ref<unknown>(null);

const id = computed(() => String(route.params.id));

async function fetch() {
  loading.value = true;
  error.value = null;
  try {
    template.value = await estimationTemplatesApi.get(id.value);
  } catch (e) {
    error.value = e;
    handle(e);
  } finally {
    loading.value = false;
  }
}

onMounted(fetch);

const headers = computed(() => [
  { title: t('estimation.columns.description'), key: 'description' },
  { title: t('estimation.columns.category'), key: 'category' },
  { title: t('estimation.columns.quantity'), key: 'quantity', align: 'end' as const },
  { title: t('estimation.columns.unit'), key: 'unit' },
  { title: t('estimation.columns.unitPrice'), key: 'unitPrice', align: 'end' as const },
  { title: t('estimation.columns.total'), key: 'totalAmount', align: 'end' as const },
]);
</script>

<template>
  <div class="mx-auto" style="max-width: 1000px">
    <PageHeader
      :title="template?.name ?? t('estimation.title')"
      back="/estimation-templates"
      icon="mdi-file-chart-outline"
    >
      <v-chip v-if="template?.isPreliminary" size="small" color="warning" variant="tonal">
        {{ t('estimation.detail.preliminary') }}
      </v-chip>
    </PageHeader>

    <ErrorState v-if="error" :error="error" class="my-4" @retry="fetch" />
    <v-progress-linear v-else-if="loading" indeterminate />

    <template v-else-if="template">
      <v-alert type="warning" variant="tonal" density="comfortable" class="mb-3">
        {{ t('estimation.preview.warning') }}
      </v-alert>

      <v-card class="mb-4">
        <v-list>
          <v-list-item :title="t('estimation.listColumns.projectType')" :subtitle="template.projectType ?? '—'" />
          <v-divider />
          <v-list-item
            :title="t('estimation.listColumns.area')"
            :subtitle="template.areaValue ? `${template.areaValue} ${template.areaUnit ?? ''}` : '—'"
          />
          <v-divider />
          <v-list-item :title="t('estimation.waste')" :subtitle="`${template.wastePercentage}%`" />
          <v-divider />
          <v-list-item :title="t('estimation.total')">
            <template #subtitle>
              <span class="text-h6"><MoneyDisplay :amount="template.estimatedTotal" /></span>
            </template>
          </v-list-item>
        </v-list>
      </v-card>

      <v-card>
        <v-data-table
          :items="template.items"
          :headers="headers"
          item-value="id"
          :items-per-page="-1"
          hide-default-footer
        >
          <template #[`item.category`]="{ item }">{{ t(`estimation.category.${item.category}`) }}</template>
          <template #[`item.quantity`]="{ item }">{{ item.quantity ?? '—' }}</template>
          <template #[`item.unit`]="{ item }">{{ item.unit ?? '—' }}</template>
          <template #[`item.unitPrice`]="{ item }">
            <MoneyDisplay v-if="item.unitPrice" :amount="item.unitPrice" />
            <span v-else>—</span>
          </template>
          <template #[`item.totalAmount`]="{ item }">
            <MoneyDisplay :amount="item.totalAmount" />
          </template>
        </v-data-table>
      </v-card>
    </template>
  </div>
</template>
