<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { t } from '@/i18n';
import { useCustomers } from '@/composables/useCustomers';
import { useConfirm } from '@/composables/useConfirm';
import { useToast } from '@/composables/useToast';
import { useApiError } from '@/composables/useApiError';
import { customersApi } from '@/services/api/customers.api';
import { buildCustomerColumns } from '@/components/features/customer/customerColumns';
import { RoleName } from '@/types/enums';
import type { Customer } from '@/types/customer';
import SearchBar from '@/components/shared/SearchBar.vue';
import ErrorState from '@/components/shared/ErrorState.vue';
import RoleGate from '@/components/shared/RoleGate.vue';
import DateDisplay from '@/components/shared/DateDisplay.vue';

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
  sortBy,
  sortDir,
  fetch,
} = useCustomers();

const WRITE_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN, RoleName.ACCOUNTANT];
const WRITE_PERMS = ['customers.create', 'customers.update', 'customers.delete'];

const columns = computed(() => buildCustomerColumns(t));

onMounted(fetch);

// Vuetify's v-data-table-server emits {page, itemsPerPage, sortBy: [{key, order}]}
function onTableUpdate(opts: {
  page: number;
  itemsPerPage: number;
  sortBy: Array<{ key: string; order: 'asc' | 'desc' }>;
}) {
  page.value = opts.page;
  pageSize.value = opts.itemsPerPage;
  const first = opts.sortBy[0];
  if (first && (first.key === 'name' || first.key === 'createdAt')) {
    sortBy.value = first.key;
    sortDir.value = first.order;
  } else if (opts.sortBy.length === 0) {
    sortBy.value = 'createdAt';
    sortDir.value = 'desc';
  }
}

function openEdit(customer: Customer) {
  void router.push(`/customers/${customer.id}`);
}

function onRowClick(_e: unknown, row: { item: Customer }) {
  openEdit(row.item);
}

async function handleDelete(customer: Customer) {
  const ok = await confirm({
    title: t('customers.deleteConfirmTitle'),
    message: t('customers.deleteConfirmMessage', { name: customer.name }),
    confirmText: t('common.delete'),
    destructive: true,
  });
  if (!ok) return;
  try {
    await customersApi.remove(customer.id);
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
      <h1 class="text-h5">{{ t('nav.customers') }}</h1>
      <RoleGate :permissions="WRITE_PERMS" :roles="WRITE_ROLES">
        <v-btn color="primary" prepend-icon="mdi-plus" to="/customers/new">
          {{ t('customers.new') }}
        </v-btn>
      </RoleGate>
    </div>

    <v-card>
      <v-card-text>
        <SearchBar v-model="searchInput" :placeholder="t('customers.searchPlaceholder')" />
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
        <template #[`item.phone`]="{ item }">
          {{ item.phone ?? '—' }}
        </template>
        <template #[`item.email`]="{ item }">
          {{ item.email ?? '—' }}
        </template>
        <template #[`item.createdAt`]="{ item }">
          <DateDisplay :value="item.createdAt" />
        </template>
        <template #[`item.actions`]="{ item }">
          <div class="flex justify-end gap-1" @click.stop>
            <RoleGate :permissions="WRITE_PERMS" :roles="WRITE_ROLES">
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
