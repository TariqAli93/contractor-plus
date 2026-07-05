<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { t } from '@/i18n';
import { useAuditLogs } from '@/composables/useAuditLogs';
import { AuditAction } from '@/types/enums';
import type { AuditLog } from '@/types/audit';
import ErrorState from '@/components/shared/ErrorState.vue';
import EmptyState from '@/components/shared/EmptyState.vue';
import DateDisplay from '@/components/shared/DateDisplay.vue';
import PageHeader from '@/components/shared/PageHeader.vue';
import AuditActionBadge from '@/components/features/audit/AuditActionBadge.vue';
import AuditDiffPanel from '@/components/features/audit/AuditDiffPanel.vue';

const router = useRouter();
const {
  items,
  total,
  loading,
  error,
  page,
  pageSize,
  entity,
  action,
  userId,
  dateFrom,
  dateTo,
  sortDir,
  fetch,
} = useAuditLogs();

// Local two-way bindings for free-text filters so user can clear them.
const entityInput = ref<string>('');
const userIdInput = ref<string>('');
const dateFromInput = ref<string | undefined>(undefined);
const dateToInput = ref<string | undefined>(undefined);

watch(entityInput, (v) => {
  entity.value = v.trim() === '' ? undefined : v.trim();
  page.value = 1;
});
watch(userIdInput, (v) => {
  userId.value = v.trim() === '' ? undefined : v.trim();
  page.value = 1;
});
watch([dateFromInput, dateToInput], ([from, to]) => {
  dateFrom.value = from || undefined;
  dateTo.value = to || undefined;
  page.value = 1;
});

const actionOptions = computed<Array<{ value: 'all' | AuditAction; title: string }>>(() => [
  { value: 'all', title: t('audit.filter.allActions') },
  { value: AuditAction.CREATE, title: 'CREATE' },
  { value: AuditAction.UPDATE, title: 'UPDATE' },
  { value: AuditAction.DELETE, title: 'DELETE' },
]);

const actionValue = computed<'all' | AuditAction>(() => action.value ?? 'all');
function onActionChange(v: 'all' | AuditAction) {
  action.value = v === 'all' ? undefined : v;
  page.value = 1;
}

onMounted(fetch);

const columns = computed(() => [
  { key: 'createdAt', title: t('audit.fields.createdAt'), sortable: true, width: 170 },
  { key: 'user', title: t('audit.fields.actor'), sortable: false, width: 220 },
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

// Inline expansion for the diff panel — opening a row reveals oldValues/newValues
// without navigating away.
const expanded = ref<string[]>([]);

function openEntityHistory(log: AuditLog) {
  void router.push(
    `/audit/entity/${encodeURIComponent(log.entity)}/${encodeURIComponent(log.entityId)}`,
  );
}

function openUserHistory(userId: string | null) {
  if (!userId) return;
  void router.push(`/audit/user/${encodeURIComponent(userId)}`);
}
</script>

<template>
  <div>
    <PageHeader :title="t('nav.audit')" icon="mdi-history" />

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
            v-model="userIdInput"
            :label="t('audit.filter.userId')"
            density="compact"
            hide-details
            clearable
            style="max-width: 280px"
          />
          <v-text-field
            v-model="dateFromInput"
            :label="t('audit.filter.dateFrom')"
            type="date"
            density="compact"
            hide-details
            style="max-width: 170px"
          />
          <v-text-field
            v-model="dateToInput"
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
        <template #[`item.user`]="{ item }">
          <div v-if="item.user">
            <button
              type="button"
              class="text-primary text-body-2"
              @click="openUserHistory(item.user?.id ?? null)"
            >
              {{ item.user.fullName }}
            </button>
            <div class="text-caption text-medium-emphasis">{{ item.user.email }}</div>
          </div>
          <span v-else class="text-medium-emphasis">system</span>
        </template>
        <template #[`item.action`]="{ item }">
          <AuditActionBadge :action="item.action" />
        </template>
        <template #[`item.entity`]="{ item }">
          {{ item.entity }}
        </template>
        <template #[`item.entityId`]="{ item }">
          <button
            type="button"
            class="text-primary text-caption font-mono"
            @click="openEntityHistory(item)"
          >
            {{ item.entityId }}
          </button>
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
          <EmptyState :title="t('audit.empty')" icon="mdi-history" />
        </template>
      </v-data-table-server>
    </v-card>
  </div>
</template>
