<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { t } from '@/i18n';
import { estimationTemplatesApi, type EstimationTemplateSummary } from '@/services/api/estimationTemplates.api';
import { useConfirm } from '@/composables/useConfirm';
import { useToast } from '@/composables/useToast';
import { useApiError } from '@/composables/useApiError';
import SearchBar from '@/components/shared/SearchBar.vue';
import ErrorState from '@/components/shared/ErrorState.vue';
import RoleGate from '@/components/shared/RoleGate.vue';
import PageHeader from '@/components/shared/PageHeader.vue';
import DateDisplay from '@/components/shared/DateDisplay.vue';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';
import { RoleName } from '@/types/enums';

const AI_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ENGINEER];
const DELETE_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN];

const router = useRouter();
const toast = useToast();
const { confirm } = useConfirm();
const { handle } = useApiError();

const items = ref<EstimationTemplateSummary[]>([]);
const total = ref(0);
const loading = ref(false);
const error = ref<unknown>(null);
const page = ref(1);
const pageSize = ref(20);
const searchInput = ref('');
const sortBy = ref<'name' | 'createdAt' | 'estimatedTotal'>('createdAt');
const sortDir = ref<'asc' | 'desc'>('desc');

const columns = computed(() => [
  { title: t('estimation.listColumns.name'), key: 'name' },
  { title: t('estimation.listColumns.projectType'), key: 'projectType' },
  { title: t('estimation.listColumns.area'), key: 'areaValue', sortable: false },
  { title: t('estimation.listColumns.total'), key: 'estimatedTotal' },
  { title: t('estimation.listColumns.createdAt'), key: 'createdAt' },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
]);

async function fetch() {
  loading.value = true;
  error.value = null;
  try {
    const res = await estimationTemplatesApi.list({
      page: page.value,
      pageSize: pageSize.value,
      search: searchInput.value || undefined,
      sortBy: sortBy.value,
      sortDir: sortDir.value,
    });
    items.value = res.items;
    total.value = res.total;
  } catch (e) {
    error.value = e;
    handle(e);
  } finally {
    loading.value = false;
  }
}

let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(searchInput, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    page.value = 1;
    void fetch();
  }, 300);
});

onMounted(fetch);

function onTableUpdate(opts: {
  page: number;
  itemsPerPage: number;
  sortBy: Array<{ key: string; order: 'asc' | 'desc' }>;
}) {
  page.value = opts.page;
  pageSize.value = opts.itemsPerPage;
  const first = opts.sortBy[0];
  if (first && (first.key === 'name' || first.key === 'createdAt' || first.key === 'estimatedTotal')) {
    sortBy.value = first.key;
    sortDir.value = first.order;
  } else if (opts.sortBy.length === 0) {
    sortBy.value = 'createdAt';
    sortDir.value = 'desc';
  }
  void fetch();
}

function openDetail(row: EstimationTemplateSummary) {
  void router.push(`/estimation-templates/${row.id}`);
}

function onRowClick(_e: unknown, row: { item: EstimationTemplateSummary }) {
  openDetail(row.item);
}

async function handleDelete(row: EstimationTemplateSummary) {
  const ok = await confirm({
    title: t('estimation.deleteConfirmTitle'),
    message: t('estimation.deleteConfirmMessage', { name: row.name }),
    confirmText: t('common.delete'),
    destructive: true,
  });
  if (!ok) return;
  try {
    await estimationTemplatesApi.remove(row.id);
    toast.success(t('common.deleted'));
    await fetch();
  } catch (e) {
    handle(e);
  }
}
</script>

<template>
  <div>
    <PageHeader :title="t('estimation.title')" icon="mdi-robot-outline" :count="total || null" :hint="t('estimation.hint')">
      <RoleGate :permissions="['estimation_templates.ai_generate']" :roles="AI_ROLES">
        <v-btn color="primary" prepend-icon="mdi-creation" to="/estimation-templates/build">
          {{ t('estimation.new') }}
        </v-btn>
      </RoleGate>
    </PageHeader>

    <v-card>
      <v-card-text class="flex flex-wrap items-center gap-3">
        <div class="flex-1 min-w-[240px]">
          <SearchBar v-model="searchInput" :placeholder="t('estimation.searchPlaceholder')" />
        </div>
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
        @click:row="onRowClick"
      >
        <template #[`item.projectType`]="{ item }">{{ item.projectType ?? '—' }}</template>
        <template #[`item.areaValue`]="{ item }">
          {{ item.areaValue ? `${item.areaValue} ${item.areaUnit ?? ''}` : '—' }}
        </template>
        <template #[`item.estimatedTotal`]="{ item }">
          <MoneyDisplay :amount="item.estimatedTotal" />
        </template>
        <template #[`item.createdAt`]="{ item }">
          <DateDisplay :value="item.createdAt" />
        </template>
        <template #[`item.actions`]="{ item }">
          <div class="flex justify-end gap-1" @click.stop>
            <v-btn icon="mdi-eye-outline" size="small" variant="text" @click="openDetail(item)" />
            <RoleGate :permissions="['estimation_templates.delete']" :roles="DELETE_ROLES">
              <v-btn icon="mdi-delete-outline" size="small" variant="text" color="error" @click="handleDelete(item)" />
            </RoleGate>
          </div>
        </template>
      </v-data-table-server>
    </v-card>
  </div>
</template>
