<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { t } from '@/i18n';
import { auditApi } from '@/services/api/audit.api';
import { ApiError } from '@/types/api';
import type { AuditLog } from '@/types/audit';
import ErrorState from '@/components/shared/ErrorState.vue';
import EmptyState from '@/components/shared/EmptyState.vue';
import DateDisplay from '@/components/shared/DateDisplay.vue';
import PageHeader from '@/components/shared/PageHeader.vue';
import AuditActionBadge from '@/components/features/audit/AuditActionBadge.vue';
import AuditDiffPanel from '@/components/features/audit/AuditDiffPanel.vue';

const route = useRoute();

const entity = computed(() => String(route.params.entity ?? ''));
const entityId = computed(() => String(route.params.entityId ?? ''));

const items = ref<AuditLog[]>([]);
const total = ref(0);
const loading = ref(false);
const error = ref<ApiError | null>(null);
const page = ref(1);
const pageSize = ref(20);
const sortDir = ref<'asc' | 'desc'>('asc');

async function fetch() {
  if (!entity.value || !entityId.value) return;
  loading.value = true;
  error.value = null;
  try {
    const res = await auditApi.getEntityHistory(entity.value, entityId.value, {
      page: page.value,
      pageSize: pageSize.value,
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

watch([entity, entityId, page, pageSize, sortDir], () => void fetch());
onMounted(fetch);

const columns = computed(() => [
  { key: 'createdAt', title: t('audit.fields.createdAt'), sortable: true, width: 170 },
  { key: 'user', title: t('audit.fields.actor'), sortable: false, width: 220 },
  { key: 'action', title: t('audit.fields.action'), sortable: false, width: 110 },
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
    <PageHeader :title="t('audit.entity.title')" back="/audit" />
    <p class="text-body-2 text-medium-emphasis mb-4">
      {{ entity }} · <span class="font-mono">{{ entityId }}</span>
    </p>

    <v-card>
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
        <template #[`item.user`]="{ item }">
          <div v-if="item.user">
            <div class="text-body-2">{{ item.user.fullName }}</div>
            <div class="text-caption text-medium-emphasis">{{ item.user.email }}</div>
          </div>
          <span v-else class="text-medium-emphasis">system</span>
        </template>
        <template #[`item.action`]="{ item }">
          <AuditActionBadge :action="item.action" />
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
          <EmptyState :title="t('audit.entity.empty')" icon="mdi-history" />
        </template>
      </v-data-table-server>
    </v-card>
  </div>
</template>
