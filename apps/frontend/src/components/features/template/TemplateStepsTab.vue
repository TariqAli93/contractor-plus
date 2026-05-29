<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { t } from '@/i18n';
import { templatesApi } from '@/services/api/templates.api';
import { useApiError } from '@/composables/useApiError';
import type { TemplateStep } from '@/types/template';
import ErrorState from '@/components/shared/ErrorState.vue';
import EmptyState from '@/components/shared/EmptyState.vue';
import TemplateStepRow from './TemplateStepRow.vue';

const props = defineProps<{ templateId: string }>();
const { handle } = useApiError();

const steps = ref<TemplateStep[]>([]);
const loading = ref(false);
const error = ref<unknown>(null);
const addingNew = ref(false);

const totalPercentage = computed(() =>
  steps.value.reduce((sum, s) => sum + Number(s.percentage), 0),
);
const totalEstimatedDays = computed(() =>
  steps.value.reduce((sum, s) => sum + (s.estimatedDays ?? 0), 0),
);
const nextSortOrder = computed(() => {
  if (steps.value.length === 0) return 1;
  return Math.max(...steps.value.map((s) => s.sortOrder)) + 1;
});

async function fetch() {
  loading.value = true;
  error.value = null;
  try {
    const template = await templatesApi.get(props.templateId);
    steps.value = template.steps;
  } catch (e) {
    error.value = e;
    handle(e);
  } finally {
    loading.value = false;
  }
}

onMounted(fetch);

function onSaved() {
  addingNew.value = false;
  void fetch();
}
function onRemoved() {
  void fetch();
}
function onCancelledNew() {
  addingNew.value = false;
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-3 gap-3 flex-wrap">
      <h2 class="text-h6">{{ t('templates.steps.title') }}</h2>
      <div class="flex items-center gap-3">
        <v-chip
          size="small"
          variant="tonal"
          :color="totalPercentage > 100 ? 'error' : totalPercentage === 100 ? 'success' : undefined"
        >
          {{ t('templates.steps.totalPercentage') }}: {{ totalPercentage.toFixed(2) }}%
        </v-chip>
        <v-chip size="small" variant="tonal">
          {{ t('templates.steps.totalDays') }}: {{ totalEstimatedDays }}
        </v-chip>
        <v-btn
          color="primary"
          variant="tonal"
          prepend-icon="mdi-plus"
          :disabled="addingNew || loading"
          @click="addingNew = true"
        >
          {{ t('templates.steps.addStep') }}
        </v-btn>
      </div>
    </div>

    <ErrorState v-if="error" :error="error" class="my-4" @retry="fetch" />

    <v-progress-linear v-else-if="loading && steps.length === 0" indeterminate />

    <template v-else>
      <v-table density="comfortable" hover>
        <thead>
          <tr>
            <th class="text-end" style="width: 90px">{{ t('templates.steps.fields.sortOrder') }}</th>
            <th class="text-start">{{ t('templates.steps.fields.name') }}</th>
            <th class="text-end" style="width: 130px">{{ t('templates.steps.fields.percentage') }}</th>
            <th class="text-end" style="width: 130px">{{ t('templates.steps.fields.estimatedDays') }}</th>
            <th class="text-end" style="width: 110px"></th>
          </tr>
        </thead>
        <tbody>
          <TemplateStepRow
            v-for="step in steps"
            :key="step.id"
            :template-id="templateId"
            :step="step"
            @saved="onSaved"
            @removed="onRemoved"
          />
          <TemplateStepRow
            v-if="addingNew"
            :template-id="templateId"
            :suggested-sort-order="nextSortOrder"
            @saved="onSaved"
            @cancelled="onCancelledNew"
          />
        </tbody>
      </v-table>

      <EmptyState
        v-if="!addingNew && steps.length === 0"
        :title="t('templates.steps.empty')"
        icon="mdi-format-list-numbered"
      />
    </template>
  </div>
</template>
