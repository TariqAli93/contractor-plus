<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { t } from '@/i18n';
import { templatesApi } from '@/services/api/templates.api';
import { useApiError } from '@/composables/useApiError';
import type { TemplateStep } from '@/types/template';
import ErrorState from '@/components/shared/ErrorState.vue';
import EmptyState from '@/components/shared/EmptyState.vue';
import SearchBar from '@/components/shared/SearchBar.vue';
import TemplateStepRow from './TemplateStepRow.vue';

const props = defineProps<{ templateId: string }>();
const { handle } = useApiError();

const steps = ref<TemplateStep[]>([]);
const loading = ref(false);
const error = ref<unknown>(null);
const addingNew = ref(false);
const searchInput = ref('');
const sortKey = ref<'sortOrder' | 'name' | 'percentage' | 'estimatedDays'>('sortOrder');
const sortDir = ref<'asc' | 'desc'>('asc');

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

const visibleSteps = computed(() => {
  const query = searchInput.value.trim().toLocaleLowerCase('ar');
  const rows = query
    ? steps.value.filter((step) => step.name.toLocaleLowerCase('ar').includes(query))
    : steps.value;
  return [...rows].sort((a, b) => {
    const left = sortKey.value === 'name' ? a.name : Number(a[sortKey.value]);
    const right = sortKey.value === 'name' ? b.name : Number(b[sortKey.value]);
    const result = typeof left === 'number' && typeof right === 'number'
      ? left - right
      : String(left).localeCompare(String(right), 'ar');
    return sortDir.value === 'asc' ? result : -result;
  });
});

function toggleSort(key: typeof sortKey.value) {
  if (sortKey.value === key) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
  else {
    sortKey.value = key;
    sortDir.value = 'asc';
  }
}

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
  <div class="cp-template-grid">
    <div class="cp-template-grid__toolbar">
      <h2 class="cp-template-grid__title">{{ t('templates.steps.title') }}</h2>
      <SearchBar v-model="searchInput" :placeholder="t('common.search')" class="cp-template-grid__search" />
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
          size="small"
          variant="flat"
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
      <v-table fixed-header hover class="cp-template-grid__table">
        <thead>
          <tr>
            <th class="text-end cp-template-grid__sort" style="width: 90px" @click="toggleSort('sortOrder')">{{ t('templates.steps.fields.sortOrder') }} <v-icon v-if="sortKey === 'sortOrder'" size="14">{{ sortDir === 'asc' ? 'mdi-menu-up' : 'mdi-menu-down' }}</v-icon></th>
            <th class="text-start cp-template-grid__sort" @click="toggleSort('name')">{{ t('templates.steps.fields.name') }} <v-icon v-if="sortKey === 'name'" size="14">{{ sortDir === 'asc' ? 'mdi-menu-up' : 'mdi-menu-down' }}</v-icon></th>
            <th class="text-end cp-template-grid__sort" style="width: 130px" @click="toggleSort('percentage')">{{ t('templates.steps.fields.percentage') }} <v-icon v-if="sortKey === 'percentage'" size="14">{{ sortDir === 'asc' ? 'mdi-menu-up' : 'mdi-menu-down' }}</v-icon></th>
            <th class="text-end cp-template-grid__sort" style="width: 130px" @click="toggleSort('estimatedDays')">{{ t('templates.steps.fields.estimatedDays') }} <v-icon v-if="sortKey === 'estimatedDays'" size="14">{{ sortDir === 'asc' ? 'mdi-menu-up' : 'mdi-menu-down' }}</v-icon></th>
            <th class="text-end" style="width: 110px"></th>
          </tr>
        </thead>
        <tbody>
          <TemplateStepRow
            v-for="step in visibleSteps"
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

<style scoped>
.cp-template-grid { min-height: 0; }
.cp-template-grid__toolbar { display: flex; align-items: center; gap: 6px; min-height: 30px; margin-bottom: 6px; }
.cp-template-grid__title { margin: 0; color: var(--cp-text); font-size: 0.82rem; font-weight: 600; }
.cp-template-grid__search { width: 190px; margin-inline-start: auto; }
.cp-template-grid__table { max-height: 520px; }
.cp-template-grid__sort { cursor: pointer; user-select: none; }
</style>
