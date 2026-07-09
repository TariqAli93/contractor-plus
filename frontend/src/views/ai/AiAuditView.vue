<script setup lang="ts">
// Unified AI audit panel — one table over the whole AiExecution trail (every
// tool/category flows through the single orchestrator now), filterable by tool
// and outcome. Read-only; gated on audit.read.
import { computed, onMounted, ref, watch } from 'vue';
import { t } from '@/i18n';
import PageHeader from '@/components/shared/PageHeader.vue';
import DateDisplay from '@/components/shared/DateDisplay.vue';
import ErrorState from '@/components/shared/ErrorState.vue';
import { aiSessionApi } from '@/services/api/aiSession.api';
import { useApiError } from '@/composables/useApiError';
import type { AiExecutionQuery, AiExecutionView } from '@contractor-plus/shared';

const { handle } = useApiError();

const items = ref<AiExecutionView[]>([]);
const total = ref(0);
const loading = ref(false);
const error = ref<unknown>(null);
const page = ref(1);
const pageSize = ref(20);
const toolName = ref('');
const transactionResult = ref<string | null>(null);

const resultOptions = computed(() =>
  (['executed', 'failed', 'cancelled', 'not_required'] as const).map((v) => ({
    title: t(`aiAudit.result.${v}`),
    value: v,
  })),
);

const columns = computed(() => [
  { title: t('aiAudit.columns.createdAt'), key: 'createdAt' },
  { title: t('aiAudit.columns.user'), key: 'userName', sortable: false },
  { title: t('aiAudit.columns.tool'), key: 'toolName', sortable: false },
  { title: t('aiAudit.columns.result'), key: 'transactionResult', sortable: false },
  { title: t('aiAudit.columns.request'), key: 'originalRequest', sortable: false },
]);

async function fetch() {
  loading.value = true;
  error.value = null;
  try {
    const query: AiExecutionQuery = {
      limit: pageSize.value,
      offset: (page.value - 1) * pageSize.value,
      toolName: toolName.value.trim() || undefined,
      transactionResult: transactionResult.value || undefined,
    };
    const res = await aiSessionApi.listAudit(query);
    items.value = res.items;
    total.value = res.total;
  } catch (e) {
    error.value = e;
    handle(e);
  } finally {
    loading.value = false;
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
watch([toolName, transactionResult], () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    page.value = 1;
    void fetch();
  }, 300);
});

onMounted(fetch);

function onTableUpdate(opts: { page: number; itemsPerPage: number }) {
  page.value = opts.page;
  pageSize.value = opts.itemsPerPage;
  void fetch();
}

function resultColor(r: string): string | undefined {
  if (r === 'executed') return 'success';
  if (r === 'failed') return 'error';
  if (r === 'cancelled') return 'warning';
  return undefined;
}
</script>

<template>
  <div>
    <PageHeader :title="t('aiAudit.title')" icon="mdi-history" :count="total || null" :hint="t('aiAudit.hint')" />

    <v-card>
      <v-card-text class="flex flex-wrap items-center gap-3">
        <v-text-field
          v-model="toolName"
          density="compact"
          hide-details
          variant="outlined"
          :placeholder="t('aiAudit.toolFilter')"
          style="max-width: 220px"
        />
        <v-select
          v-model="transactionResult"
          :items="resultOptions"
          clearable
          density="compact"
          hide-details
          variant="outlined"
          :placeholder="t('aiAudit.resultFilter')"
          style="max-width: 240px"
        />
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
        @update:options="onTableUpdate"
      >
        <template #[`item.createdAt`]="{ item }"><DateDisplay :value="item.createdAt" /></template>
        <template #[`item.userName`]="{ item }">{{ item.userName ?? '—' }}</template>
        <template #[`item.toolName`]="{ item }">{{ item.toolName ?? '—' }}</template>
        <template #[`item.transactionResult`]="{ item }">
          <v-chip size="x-small" :color="resultColor(item.transactionResult)" variant="tonal">
            {{ t(`aiAudit.result.${item.transactionResult}`) }}
          </v-chip>
        </template>
        <template #[`item.originalRequest`]="{ item }">
          <span>{{ item.originalRequest }}</span>
          <span v-if="item.failedReason" class="ai-audit__reason"> — {{ item.failedReason }}</span>
        </template>
      </v-data-table-server>
    </v-card>
  </div>
</template>

<style scoped>
.ai-audit__reason {
  color: rgb(var(--v-theme-error));
  font-size: 0.8rem;
}
</style>
