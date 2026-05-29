<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useMaterials } from '@/composables/useMaterials';
import { useConfirm } from '@/composables/useConfirm';
import { useToast } from '@/composables/useToast';
import { useApiError } from '@/composables/useApiError';
import { materialsApi } from '@/services/api/materials.api';
import { buildMaterialColumns } from '@/components/features/material/materialColumns';
import { RoleName } from '@/types/enums';
import type { Material } from '@/types/material';
import SearchBar from '@/components/shared/SearchBar.vue';
import ErrorState from '@/components/shared/ErrorState.vue';
import RoleGate from '@/components/shared/RoleGate.vue';
import DateDisplay from '@/components/shared/DateDisplay.vue';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';

const router = useRouter();
const { t } = useI18n();
const toast = useToast();
const { confirm } = useConfirm();
const { handle } = useApiError();

const {
  items,
  total,
  loading,
  error,
  page,
  pageSize,
  searchInput,
  isActive,
  sortBy,
  sortDir,
  fetch,
  setIsActiveFilter,
} = useMaterials();

const WRITE_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT];

const columns = computed(() => buildMaterialColumns(t));

// Chip-group value: 'all' | 'active' | 'inactive'. Synced with isActive ref.
const filterValue = computed<'all' | 'active' | 'inactive'>(() => {
  if (isActive.value === true) return 'active';
  if (isActive.value === false) return 'inactive';
  return 'all';
});

function onFilterChange(v: 'all' | 'active' | 'inactive') {
  if (v === 'active') setIsActiveFilter(true);
  else if (v === 'inactive') setIsActiveFilter(false);
  else setIsActiveFilter(undefined);
}

onMounted(fetch);

function onTableUpdate(opts: {
  page: number;
  itemsPerPage: number;
  sortBy: Array<{ key: string; order: 'asc' | 'desc' }>;
}) {
  page.value = opts.page;
  pageSize.value = opts.itemsPerPage;
  const first = opts.sortBy[0];
  if (first && (first.key === 'name' || first.key === 'createdAt' || first.key === 'defaultPrice')) {
    sortBy.value = first.key;
    sortDir.value = first.order;
  } else if (opts.sortBy.length === 0) {
    sortBy.value = 'name';
    sortDir.value = 'asc';
  }
}

function openEdit(material: Material) {
  void router.push(`/materials/${material.id}`);
}

async function handleDelete(material: Material) {
  const ok = await confirm({
    title: t('materials.deleteConfirmTitle'),
    message: t('materials.deleteConfirmMessage', { name: material.name }),
    confirmText: t('common.delete'),
    destructive: true,
  });
  if (!ok) return;
  try {
    await materialsApi.remove(material.id);
    toast.success(t('common.deleted'));
    await fetch();
  } catch (e) {
    handle(e);
  }
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-4 gap-2 flex-wrap">
      <h1 class="text-h5">{{ t('nav.materials') }}</h1>
      <RoleGate :roles="WRITE_ROLES">
        <v-btn color="primary" prepend-icon="mdi-plus" to="/materials/new">
          {{ t('materials.new') }}
        </v-btn>
      </RoleGate>
    </div>

    <v-card>
      <v-card-text class="flex flex-wrap items-center gap-3">
        <div class="flex-1 min-w-[240px]">
          <SearchBar v-model="searchInput" :placeholder="t('materials.searchPlaceholder')" />
        </div>
        <v-chip-group
          :model-value="filterValue"
          mandatory
          selected-class="bg-primary text-white"
          @update:model-value="onFilterChange"
        >
          <v-chip value="all" size="small">{{ t('materials.filter.all') }}</v-chip>
          <v-chip value="active" size="small">{{ t('materials.filter.active') }}</v-chip>
          <v-chip value="inactive" size="small">{{ t('materials.filter.inactive') }}</v-chip>
        </v-chip-group>
      </v-card-text>

      <v-divider />

      <ErrorState v-if="error" :error="error" class="my-4" @retry="fetch" />

      <v-data-table-server
        v-else
        :items="items"
        :items-length="total"
        :headers="columns"
        :loading="loading"
        :page="page"
        :items-per-page="pageSize"
        :items-per-page-options="[10, 20, 50, 100]"
        item-value="id"
        hover
        @update:options="onTableUpdate"
        @click:row="(_e: unknown, row: { item: Material }) => openEdit(row.item)"
      >
        <template #[`item.defaultPrice`]="{ item }">
          <MoneyDisplay :amount="item.defaultPrice" />
        </template>
        <template #[`item.isActive`]="{ item }">
          <v-chip
            size="small"
            variant="tonal"
            :color="item.isActive ? 'success' : undefined"
            :prepend-icon="item.isActive ? 'mdi-check-circle' : 'mdi-circle-off-outline'"
          >
            {{ item.isActive ? t('materials.status.active') : t('materials.status.inactive') }}
          </v-chip>
        </template>
        <template #[`item.createdAt`]="{ item }">
          <DateDisplay :value="item.createdAt" />
        </template>
        <template #[`item.actions`]="{ item }">
          <div class="flex justify-end gap-1" @click.stop>
            <RoleGate :roles="WRITE_ROLES">
              <v-btn
                icon="mdi-pencil"
                size="small"
                variant="text"
                @click="openEdit(item)"
              />
              <v-btn
                icon="mdi-delete-outline"
                size="small"
                variant="text"
                color="error"
                @click="handleDelete(item)"
              />
            </RoleGate>
          </div>
        </template>
      </v-data-table-server>
    </v-card>
  </div>
</template>
