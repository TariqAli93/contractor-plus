<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { t } from '@/i18n';
import { useContracts } from '@/composables/useContracts';
import { ContractStatus, RoleName } from '@/types/enums';
import type { Contract } from '@/types/contract';
import SearchBar from '@/components/shared/SearchBar.vue';
import PageHeader from '@/components/shared/PageHeader.vue';
import ErrorState from '@/components/shared/ErrorState.vue';
import RoleGate from '@/components/shared/RoleGate.vue';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';
import DateDisplay from '@/components/shared/DateDisplay.vue';
import ContractStatusBadge from '@/components/features/contract/ContractStatusBadge.vue';
import ContractDetailPanel from '@/components/features/contract/ContractDetailPanel.vue';
import WorkspaceSplit from '@/components/shared/workspace/WorkspaceSplit.vue';
import DetailsPane from '@/components/shared/workspace/DetailsPane.vue';
import DataTable from '@/components/shared/DataTable.vue';

type ContractRow = Contract & { customer?: { name: string } };

const route = useRoute();
const router = useRouter();
const splitActive = ref(true);
const { items, total, loading, error, page, pageSize, searchInput, status, sortBy, sortDir, fetch, setStatusFilter } = useContracts();
const WRITE_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT];
const WRITE_PERMS = ['contracts.create', 'contracts.update', 'contracts.delete'];
const selectedId = ref<string | undefined>(
  typeof route.query.p === 'string' ? route.query.p : undefined,
);
const statusFilter = computed<'all' | ContractStatus>(() => status.value ?? 'all');
const selectedNumber = computed(
  () => (items.value as ContractRow[]).find((contract) => contract.id === selectedId.value)?.contractNumber ?? null,
);

function onStatusChange(value: 'all' | ContractStatus) {
  setStatusFilter(value === 'all' ? undefined : value);
}

function select(contract: Contract) {
  if (!splitActive.value) {
    void router.push(`/contracts/${contract.id}`);
    return;
  }
  selectedId.value = contract.id;
  void router.replace({ query: { ...route.query, p: contract.id } });
}

const columns = computed(() => [
  { key: 'contractNumber', title: t('contracts.fields.contractNumber'), sortable: true },
  { key: 'customer', title: t('contracts.fields.customer'), sortable: false },
  { key: 'status', title: t('contracts.fields.status'), sortable: false, width: 120 },
  { key: 'totalPrice', title: t('contracts.fields.totalPrice'), sortable: true, width: 150, align: 'end' as const },
  { key: 'signedAt', title: t('contracts.fields.signedAt'), sortable: false, width: 135 },
]);

function onTableUpdate(opts: {
  page: number;
  itemsPerPage: number;
  sortBy: Array<{ key: string; order: 'asc' | 'desc' }>;
}) {
  page.value = opts.page;
  pageSize.value = opts.itemsPerPage;
  const first = opts.sortBy[0];
  if (first && (first.key === 'contractNumber' || first.key === 'totalPrice')) {
    sortBy.value = first.key;
    sortDir.value = first.order;
  }
}

function rowProps({ item }: { item: Contract }) {
  return item.id === selectedId.value ? { class: 'cp-row-selected' } : {};
}

onMounted(fetch);
</script>

<template>
  <div class="cp-fill">
    <PageHeader :title="t('nav.contracts')" :count="total || null" icon="mdi-file-sign" :hint="t('help.contracts')">
      <RoleGate :permissions="WRITE_PERMS" :roles="WRITE_ROLES">
        <v-btn color="primary" prepend-icon="mdi-plus" to="/contracts/new">
          {{ t('contracts.new') }}
        </v-btn>
      </RoleGate>
    </PageHeader>

    <WorkspaceSplit
      storage-key="contracts"
      :default-width="580"
      :min-master="430"
      :min-details="360"
      @update:show-details="splitActive = $event"
    >
      <div class="cp-pane">
        <div class="cp-pane__toolbar cp-contracts__filters">
          <SearchBar v-model="searchInput" :placeholder="t('contracts.searchPlaceholder')" />
          <v-chip-group :model-value="statusFilter" mandatory @update:model-value="onStatusChange">
            <v-chip value="all">{{ t('contracts.filter.all') }}</v-chip>
            <v-chip :value="ContractStatus.DRAFT">{{ t('contracts.status.DRAFT') }}</v-chip>
            <v-chip :value="ContractStatus.APPROVED">{{ t('contracts.status.APPROVED') }}</v-chip>
            <v-chip :value="ContractStatus.CANCELLED">{{ t('contracts.status.CANCELLED') }}</v-chip>
          </v-chip-group>
        </div>

        <ErrorState v-if="error" :error="error" class="ma-2" @retry="fetch" />
        <div v-else class="cp-pane__body">
          <DataTable
            :items="items as ContractRow[]"
            :items-length="total"
            :headers="columns"
            :loading="loading"
            :page="page"
            :items-per-page="pageSize"
            :row-props="rowProps"
            item-value="id"
            @update:options="onTableUpdate"
            @click:row="(_event, row) => select(row.item)"
            @dblclick:row="(_event, row) => router.push(`/contracts/${row.item.id}`)"
          >
            <template #[`item.contractNumber`]="{ item }"><span class="cp-contracts-table__number">{{ item.contractNumber }}</span></template>
            <template #[`item.customer`]="{ item }">{{ item.customer?.name ?? '-' }}</template>
            <template #[`item.status`]="{ item }"><ContractStatusBadge :status="item.status" /></template>
            <template #[`item.totalPrice`]="{ item }"><span class="cp-contracts-table__amount"><MoneyDisplay :amount="item.totalPrice" /></span></template>
            <template #[`item.signedAt`]="{ item }"><DateDisplay :value="item.signedAt" /></template>
            <template #no-data><span class="cp-contracts-table__empty">{{ t('common.empty') }}</span></template>
          </DataTable>
        </div>
      </div>

      <template #details>
        <DetailsPane :title="selectedNumber ?? t('nav.contracts')" icon="mdi-file-sign" :selected="Boolean(selectedId)">
          <ContractDetailPanel v-if="selectedId" :contract-id="selectedId" @changed="fetch" />
          <template #actions>
            <v-btn size="x-small" variant="text" prepend-icon="mdi-open-in-new" :to="`/contracts/${selectedId}`">
              {{ t('contracts.openFull') }}
            </v-btn>
          </template>
        </DetailsPane>
      </template>
    </WorkspaceSplit>
  </div>
</template>

<style scoped>
.cp-contracts__filters {
  flex-wrap: wrap;
  row-gap: 2px;
}
.cp-contracts-table__number,
.cp-contracts-table__amount {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.cp-contracts-table__empty {
  display: block;
  padding: 16px;
  color: var(--cp-text-muted);
}
</style>
