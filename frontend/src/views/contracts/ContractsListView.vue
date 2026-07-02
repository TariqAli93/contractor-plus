<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { t } from '@/i18n';
import { useContracts } from '@/composables/useContracts';
import { useConfirm } from '@/composables/useConfirm';
import { useToast } from '@/composables/useToast';
import { useApiError } from '@/composables/useApiError';
import { contractsApi } from '@/services/api/contracts.api';
import { buildContractColumns } from '@/components/features/contract/contractColumns';
import { ContractStatus, RoleName } from '@/types/enums';
import type { Contract } from '@/types/contract';
import SearchBar from '@/components/shared/SearchBar.vue';
import ErrorState from '@/components/shared/ErrorState.vue';
import RoleGate from '@/components/shared/RoleGate.vue';
import PageHeader from '@/components/shared/PageHeader.vue';
import DateDisplay from '@/components/shared/DateDisplay.vue';
import MoneyDisplay from '@/components/shared/MoneyDisplay.vue';
import ContractStatusBadge from '@/components/features/contract/ContractStatusBadge.vue';

const router = useRouter();
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
  status,
  sortBy,
  sortDir,
  fetch,
  setStatusFilter,
} = useContracts();

const WRITE_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT];
const WRITE_PERMS = ['contracts.create', 'contracts.update', 'contracts.delete'];

const columns = computed(() => buildContractColumns(t));

const statusFilter = computed<'all' | ContractStatus>(() => status.value ?? 'all');

function onStatusChange(v: 'all' | ContractStatus) {
  setStatusFilter(v === 'all' ? undefined : v);
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
  if (
    first &&
    (first.key === 'createdAt' || first.key === 'contractNumber' || first.key === 'totalPrice')
  ) {
    sortBy.value = first.key;
    sortDir.value = first.order;
  } else if (opts.sortBy.length === 0) {
    sortBy.value = 'createdAt';
    sortDir.value = 'desc';
  }
}

// Row shape as the data-table renders it (Contract plus the joined customer).
type ContractRow = Contract & { customer?: { name: string } };

function openEdit(contract: Contract) {
  void router.push(`/contracts/${contract.id}`);
}

// Inline-typed arrow handlers in templates don't parse under vue-tsc, so the
// row click handler lives here with explicit types.
function onRowClick(_e: unknown, row: { item: Contract }) {
  openEdit(row.item);
}

async function handleDelete(contract: Contract) {
  const ok = await confirm({
    title: t('contracts.deleteConfirmTitle'),
    message: t('contracts.deleteConfirmMessage', { number: contract.contractNumber }),
    confirmText: t('common.delete'),
    destructive: true,
  });
  if (!ok) return;
  try {
    await contractsApi.remove(contract.id);
    toast.success(t('common.deleted'));
    await fetch();
  } catch (e) {
    handle(e);
  }
}
</script>

<template>
  <div>
    <PageHeader :title="t('nav.contracts')" icon="mdi-file-sign" :count="total || null">
      <RoleGate :permissions="WRITE_PERMS" :roles="WRITE_ROLES">
        <v-btn color="primary" prepend-icon="mdi-plus" to="/contracts/new">
          {{ t('contracts.new') }}
        </v-btn>
      </RoleGate>
    </PageHeader>

    <v-card>
      <v-card-text class="flex flex-wrap items-center gap-3">
        <div class="flex-1 min-w-[240px]">
          <SearchBar v-model="searchInput" :placeholder="t('contracts.searchPlaceholder')" />
        </div>
        <v-chip-group
          :model-value="statusFilter"
          mandatory
          selected-class="bg-primary text-white"
          @update:model-value="onStatusChange"
        >
          <v-chip value="all" size="small">{{ t('contracts.filter.all') }}</v-chip>
          <v-chip :value="ContractStatus.DRAFT" size="small">
            {{ t('contracts.status.DRAFT') }}
          </v-chip>
          <v-chip :value="ContractStatus.APPROVED" size="small">
            {{ t('contracts.status.APPROVED') }}
          </v-chip>
          <v-chip :value="ContractStatus.CANCELLED" size="small">
            {{ t('contracts.status.CANCELLED') }}
          </v-chip>
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
        @click:row="onRowClick"
      >
        <template #[`item.customer`]="{ item }">
          {{ (item as ContractRow).customer?.name ?? '—' }}
        </template>
        <template #[`item.totalPrice`]="{ item }">
          <MoneyDisplay :amount="item.totalPrice" />
        </template>
        <template #[`item.status`]="{ item }">
          <ContractStatusBadge :status="item.status" />
        </template>
        <template #[`item.createdAt`]="{ item }">
          <DateDisplay :value="item.createdAt" />
        </template>
        <template #[`item.actions`]="{ item }">
          <div class="flex justify-end gap-1" @click.stop>
            <RoleGate :permissions="WRITE_PERMS" :roles="WRITE_ROLES">
              <v-btn
                icon="mdi-delete-outline"
                size="small"
                variant="text"
                color="error"
                :disabled="item.status === ContractStatus.APPROVED"
                @click="handleDelete(item)"
              />
            </RoleGate>
          </div>
        </template>
      </v-data-table-server>
    </v-card>
  </div>
</template>
