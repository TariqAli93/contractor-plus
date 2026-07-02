<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { t } from '@/i18n';
import { auditApi } from '@/services/api/audit.api';
import { ApiError } from '@/types/api';
import { AuditAction } from '@/types/enums';
import type { AuditLog } from '@/types/audit';
import ErrorState from '@/components/shared/ErrorState.vue';
import EmptyState from '@/components/shared/EmptyState.vue';
import DateDisplay from '@/components/shared/DateDisplay.vue';
import PageHeader from '@/components/shared/PageHeader.vue';
import AuditActionBadge from '@/components/features/audit/AuditActionBadge.vue';
import AuditDiffPanel from '@/components/features/audit/AuditDiffPanel.vue';

const route = useRoute();

const userId = computed(() => String(route.params.userId ?? ''));

const items = ref<AuditLog[]>([]);
const total = ref(0);
const loading = ref(false);
const error = ref<ApiError | null>(null);

const page = ref(1);
const pageSize = ref(20);
const entityFilter = ref<string | undefined>(undefined);
const actionFilter = ref<AuditAction | undefined>(undefined);
const dateFrom = ref<string | undefined>(undefined);
const dateTo = ref<string | undefined>(undefined);
const sortDir = ref<'asc' | 'desc'>('desc');

async function fetch() {
  if (!userId.value) return;
  loading.value = true;
  error.value = null;
  try {
    const res = await auditApi.getUserHistory(userId.value, {
      page: page.value,
      pageSize: pageSize.value,
      entity: entityFilter.value,
      action: actionFilter.value,
      dateFrom: dateFrom.value,
      dateTo: dateTo.value,
      sortDir: sortDir.value,
    });
    items.value = res.items;
    total.value = res.total;
  } catch (e) {
    error.value = e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', String(e));
  } finally {
    loading.value = false;
  }
}

watch(
  [userId, page, pageSize, entityFilter, actionFilter, dateFrom, dateTo, sortDir],
  () => void fetch(),
);
onMounted(fetch);

const actionOptions = computed<Array<{ value: 'all' | AuditAction; title: string }>>(() => [
  { value: 'all', title: t('audit.filter.allActions') },
  { value: AuditAction.CREATE, title: 'CREATE' },
  { value: AuditAction.UPDATE, title: 'UPDATE' },
  { value: AuditAction.DELETE, title: 'DELETE' },
]);

const actionValue = computed<'all' | AuditAction>(() => actionFilter.value ?? 'all');
function onActionChange(v: 'all' | AuditAction) {
  actionFilter.value = v === 'all' ? undefined : v;
  page.value = 1;
}

const entityInput = ref<string>('');
watch(entityInput, (v) => {
  entityFilter.value = v.trim() === '' ? undefined : v.trim();
  page.value = 1;
});

const userDisplay = computed(() => {
  const first = items.value[0];
  return first?.user ? `${first.user.fullName} (${first.user.email})` : userId.value;
});

const columns = computed(() => [
  { key: 'createdAt', title: t('audit.fields.createdAt'), sortable: true, width: 170 },
  { key: 'action', title: t('audit.fields.action'), sortable: false, width: 110 },
  { key: 'entity', title: t('audit.fields.entity'), sortable: false, width: 140 },
  { key: 'entityId', title: t('audit.fields.entityId'), sortable: false },
  { key: 'ipAddress', title: t('audit.fields.ip'), sortable: false, width: 130 },
]);

function onTableUpdate(opts: {
  page: number;
  itemsPerPage: number;
  sortBy: Array<{ key: string; order: 'asc' | 'desc' }>;
}) {
  page.value = opts.page;
  pageSize.value = opts.itemsPerPage;
  const first = opts.sortBy[0];
  if (first) sortDir.value = first.order;
}

const expanded = ref<string[]>([]);
</script>

<template>
  <div>
    <PageHeader :title="t('audit.user.title')" :subtitle="userDisplay" back="/audit" />

    <v-card>
      <v-card-text class="space-y-3">
        <div class="flex flex-wrap items-center gap-3">
          <v-text-field
            v-model="entityInput"
            :label="t('audit.filter.entity')"
            density="compact"
            hide-details
            clearable
            style="max-width: 200px"
          />
          <v-text-field
            v-model="dateFrom"
            :label="t('audit.filter.dateFrom')"
            type="date"
            density="compact"
            hide-details
            style="max-width: 170px"
          />
          <v-text-field
            v-model="dateTo"
            :label="t('audit.filter.dateTo')"
            type="date"
            density="compact"
            hide-details
            style="max-width: 170px"
          />
        </div>
        <v-chip-group
          :model-value="actionValue"
          mandatory
          selected-class="bg-primary text-white"
          @update:model-value="onActionChange"
        >
          <v-chip
            v-for="opt in actionOptions"
            :key="opt.value"
            :value="opt.value"
            size="small"
          >
            {{ opt.title }}
          </v-chip>
        </v-chip-group>
      </v-card-text>

      <v-divider />

      <ErrorState v-if="error" :error="error" class="my-4" @retry="fetch" />

      <v-data-table-server
        v-else
        v-model:expanded="expanded"
        :items="items"
        :items-length="total"
        :headers="columns"
        :loading="loading"
        :page="page"
        :items-per-page="pageSize"
        :items-per-page-options="[10, 20, 50, 100]"
        item-value="id"
        show-expand
        hover
        @update:options="onTableUpdate"
      >
        <template #[`item.createdAt`]="{ item }">
          <DateDisplay :value="item.createdAt" />
        </template>
        <template #[`item.action`]="{ item }">
          <AuditActionBadge :action="item.action" />
        </template>
        <template #[`item.entityId`]="{ item }">
          <RouterLink
            :to="`/audit/entity/${encodeURIComponent(item.entity)}/${encodeURIComponent(item.entityId)}`"
            class="text-primary text-caption font-mono"
          >
            {{ item.entityId }}
          </RouterLink>
        </template>
        <template #[`item.ipAddress`]="{ item }">
          {{ item.ipAddress ?? '—' }}
        </template>
        <template #expanded-row="{ columns: cols, item }">
          <tr>
            <td :colspan="cols.length" class="pa-4">
              <AuditDiffPanel :old-values="item.oldValues" :new-values="item.newValues" />
            </td>
          </tr>
        </template>
        <template #no-data>
          <EmptyState :title="t('audit.user.empty')" icon="mdi-history" />
        </template>
      </v-data-table-server>
    </v-card>
  </div>
</template>
