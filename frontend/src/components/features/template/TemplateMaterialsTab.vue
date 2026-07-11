<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { t } from '@/i18n';
import { templatesApi } from '@/services/api/templates.api';
import { materialsApi } from '@/services/api/materials.api';
import { useApiError } from '@/composables/useApiError';
import type { TemplateItem } from '@/types/template';
import type { Material } from '@/types/material';
import ErrorState from '@/components/shared/ErrorState.vue';
import EmptyState from '@/components/shared/EmptyState.vue';
import SearchBar from '@/components/shared/SearchBar.vue';
import TemplateMaterialRow from './TemplateMaterialRow.vue';

const props = defineProps<{ templateId: string }>();
const { handle } = useApiError();

const items = ref<TemplateItem[]>([]);
const materials = ref<Material[]>([]);
const loading = ref(false);
const error = ref<unknown>(null);
const addingNew = ref(false);
const searchInput = ref('');
const sortKey = ref<'material' | 'quantity' | 'price'>('material');
const sortDir = ref<'asc' | 'desc'>('asc');

const visibleItems = computed(() => {
  const query = searchInput.value.trim().toLocaleLowerCase('ar');
  const rows = query
    ? items.value.filter((item) =>
      [item.material.name, item.material.unit, item.notes ?? ''].some((value) =>
        value.toLocaleLowerCase('ar').includes(query),
      ),
    )
    : items.value;
  return [...rows].sort((a, b) => {
    const left = sortKey.value === 'material'
      ? a.material.name
      : sortKey.value === 'quantity' ? Number(a.estimatedQuantity) : Number(a.estimatedPrice);
    const right = sortKey.value === 'material'
      ? b.material.name
      : sortKey.value === 'quantity' ? Number(b.estimatedQuantity) : Number(b.estimatedPrice);
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
  <div class="cp-template-grid">
    <div class="cp-template-grid__toolbar">
      <h2 class="cp-template-grid__title">{{ t('templates.items.title') }}</h2>
      <SearchBar v-model="searchInput" :placeholder="t('common.search')" class="cp-template-grid__search" />
      <v-btn
        color="primary"
        size="small"
        variant="flat"
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
      <v-table fixed-header hover class="cp-template-grid__table">
        <thead>
          <tr>
            <th class="text-start cp-template-grid__sort" @click="toggleSort('material')">
              {{ t('templates.items.fields.material') }}
              <v-icon v-if="sortKey === 'material'" size="14">{{ sortDir === 'asc' ? 'mdi-menu-up' : 'mdi-menu-down' }}</v-icon>
            </th>
            <th class="text-start" style="width: 90px">{{ t('templates.items.fields.unit') }}</th>
            <th class="text-end cp-template-grid__sort" style="width: 180px" @click="toggleSort('quantity')">
              {{ t('templates.items.fields.quantityPer100m2') }}
              <v-icon v-if="sortKey === 'quantity'" size="14">{{ sortDir === 'asc' ? 'mdi-menu-up' : 'mdi-menu-down' }}</v-icon>
            </th>
            <th class="text-end cp-template-grid__sort" style="width: 140px" @click="toggleSort('price')">
              {{ t('templates.items.fields.estimatedPrice') }}
              <v-icon v-if="sortKey === 'price'" size="14">{{ sortDir === 'asc' ? 'mdi-menu-up' : 'mdi-menu-down' }}</v-icon>
            </th>
            <th class="text-start">{{ t('templates.items.fields.notes') }}</th>
            <th class="text-end" style="width: 110px"></th>
          </tr>
        </thead>
        <tbody>
          <TemplateMaterialRow
            v-for="item in visibleItems"
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

<style scoped>
.cp-template-grid { min-height: 0; }
.cp-template-grid__toolbar { display: flex; align-items: center; gap: 6px; min-height: 30px; margin-bottom: 6px; }
.cp-template-grid__title { margin: 0; color: var(--cp-text); font-size: 0.82rem; font-weight: 600; }
.cp-template-grid__search { width: 220px; margin-inline-start: auto; }
.cp-template-grid__table { max-height: 520px; }
.cp-template-grid__sort { cursor: pointer; user-select: none; }
</style>
