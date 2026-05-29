<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { t } from '@/i18n';
import { templatesApi } from '@/services/api/templates.api';
import { materialsApi } from '@/services/api/materials.api';
import { useApiError } from '@/composables/useApiError';
import type { TemplateItem } from '@/types/template';
import type { Material } from '@/types/material';
import ErrorState from '@/components/shared/ErrorState.vue';
import EmptyState from '@/components/shared/EmptyState.vue';
import TemplateMaterialRow from './TemplateMaterialRow.vue';

const props = defineProps<{ templateId: string }>();
const { handle } = useApiError();

const items = ref<TemplateItem[]>([]);
const materials = ref<Material[]>([]);
const loading = ref(false);
const error = ref<unknown>(null);
const addingNew = ref(false);

async function fetch() {
  loading.value = true;
  error.value = null;
  try {
    const [template, materialList] = await Promise.all([
      templatesApi.get(props.templateId),
      materialsApi.list({ pageSize: 1000, isActive: true, sortBy: 'name', sortDir: 'asc' }),
    ]);
    items.value = template.items;
    materials.value = materialList.items;
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
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-h6">{{ t('templates.items.title') }}</h2>
      <v-btn
        color="primary"
        variant="tonal"
        prepend-icon="mdi-plus"
        :disabled="addingNew || loading"
        @click="addingNew = true"
      >
        {{ t('templates.items.addItem') }}
      </v-btn>
    </div>

    <ErrorState v-if="error" :error="error" class="my-4" @retry="fetch" />

    <v-progress-linear v-else-if="loading && items.length === 0" indeterminate />

    <template v-else>
      <v-table density="comfortable" hover>
        <thead>
          <tr>
            <th class="text-start">{{ t('templates.items.fields.material') }}</th>
            <th class="text-start" style="width: 90px">{{ t('templates.items.fields.unit') }}</th>
            <th class="text-end" style="width: 180px">{{ t('templates.items.fields.quantityPer100m2') }}</th>
            <th class="text-end" style="width: 140px">{{ t('templates.items.fields.estimatedPrice') }}</th>
            <th class="text-start">{{ t('templates.items.fields.notes') }}</th>
            <th class="text-end" style="width: 110px"></th>
          </tr>
        </thead>
        <tbody>
          <TemplateMaterialRow
            v-for="item in items"
            :key="item.id"
            :template-id="templateId"
            :materials="materials"
            :item="item"
            @saved="onSaved"
            @removed="onRemoved"
          />
          <TemplateMaterialRow
            v-if="addingNew"
            :template-id="templateId"
            :materials="materials"
            @saved="onSaved"
            @cancelled="onCancelledNew"
          />
        </tbody>
      </v-table>

      <EmptyState
        v-if="!addingNew && items.length === 0"
        :title="t('templates.items.empty')"
        icon="mdi-package-variant"
      />
    </template>
  </div>
</template>
