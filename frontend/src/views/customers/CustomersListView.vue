<script setup lang="ts">
// Customers workspace: a dense grid on one side, the selected customer's
// property sheet on the other. Single click selects (the pane follows), double
// click opens the full record - the Explorer/Access convention. On a window too
// narrow for two panes the single click navigates instead.
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
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
import PageHeader from '@/components/shared/PageHeader.vue';
import DateDisplay from '@/components/shared/DateDisplay.vue';
import DataTable from '@/components/shared/DataTable.vue';
import WorkspaceSplit from '@/components/shared/workspace/WorkspaceSplit.vue';
import DetailsPane from '@/components/shared/workspace/DetailsPane.vue';
import PropertyGrid from '@/components/shared/workspace/PropertyGrid.vue';
import type { PropertyRow } from '@/components/shared/workspace/types';

const route = useRoute();
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

// Selection is mirrored to ?id= so a refresh reopens the same record.
const selectedId = ref<string | null>(
  typeof route.query.id === 'string' ? route.query.id : null,
);
const selected = computed<Customer | null>(
  () => items.value.find((c) => c.id === selectedId.value) ?? null,
);

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

// True when the details pane is actually on screen; WorkspaceSplit owns the rule.
const splitActive = ref(true);

function select(customer: Customer) {
  if (!splitActive.value) {
    openEdit(customer);
    return;
  }
  selectedId.value = customer.id;
  void router.replace({ query: { ...route.query, id: customer.id } });
}

function onRowClick(_e: unknown, row: { item: Customer }) {
  select(row.item);
}
function onRowDblClick(_e: unknown, row: { item: Customer }) {
  openEdit(row.item);
}

/** Mark the selected row so the grid and the pane agree at a glance. */
function rowProps({ item }: { item: Customer }) {
  return item.id === selectedId.value ? { class: 'cp-row-selected' } : {};
}

const rows = computed<PropertyRow[]>(() => {
  const c = selected.value;
  if (!c) return [];
  return [
    { key: 'name', label: t('customers.fields.name'), value: c.name },
    { key: 'phone', label: t('customers.fields.phone'), value: c.phone, tabular: true },
    { key: 'email', label: t('customers.fields.email'), value: c.email },
    { key: 'address', label: t('customers.fields.address'), value: c.address },
    { key: 'createdAt', label: t('customers.fields.createdAt') },
  ];
});

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
    if (selectedId.value === customer.id) selectedId.value = null;
    await fetch();
  } catch (e) {
    handle(e);
  }
}
</script>

<template>
  <div class="cp-fill">
    <PageHeader
      :title="t('nav.customers')"
      icon="mdi-account-multiple-outline"
      :count="total || null"
      :hint="t('help.customers')"
    >
      <RoleGate :permissions="WRITE_PERMS" :roles="WRITE_ROLES">
        <v-btn color="primary" size="small" variant="flat" prepend-icon="mdi-plus" to="/customers/new">
          {{ t('customers.new') }}
        </v-btn>
      </RoleGate>
    </PageHeader>

    <WorkspaceSplit storage-key="customers" @update:show-details="splitActive = $event">
      <div class="cp-pane">
          <div class="cp-pane__toolbar">
            <SearchBar v-model="searchInput" :placeholder="t('customers.searchPlaceholder')" />
          </div>

          <ErrorState v-if="error" :error="error" class="ma-3" @retry="fetch" />

          <div v-else class="cp-pane__body">
            <DataTable
              :items="items"
              :items-length="total"
              :headers="columns"
              :loading="loading"
              :page="page"
              :items-per-page="pageSize"
              :items-per-page-options="[25, 50, 100, 200]"
              item-value="id"
              hover
              density="compact"
              :row-props="rowProps"
              @update:options="onTableUpdate"
              @click:row="onRowClick"
              @dblclick:row="onRowDblClick"
            >
              <template #[`item.phone`]="{ item }">{{ item.phone ?? '-' }}</template>
              <template #[`item.email`]="{ item }">{{ item.email ?? '-' }}</template>
              <template #[`item.createdAt`]="{ item }">
                <DateDisplay :value="item.createdAt" />
              </template>
              <template #[`item.actions`]="{ item }">
                <div class="cp-row-actions" @click.stop>
                  <RoleGate :permissions="WRITE_PERMS" :roles="WRITE_ROLES">
                    <v-btn icon="mdi-pencil" size="x-small" variant="text" @click="openEdit(item)" />
                    <v-btn
                      icon="mdi-delete-outline"
                      size="x-small"
                      variant="text"
                      color="error"
                      @click="handleDelete(item)"
                    />
                  </RoleGate>
                </div>
              </template>
            </DataTable>
        </div>
      </div>

      <template #details>
        <DetailsPane
          :title="selected?.name ?? t('details.title')"
          icon="mdi-account-outline"
          :selected="Boolean(selected)"
        >
          <PropertyGrid :rows="rows">
            <template #createdAt>
              <DateDisplay :value="selected?.createdAt" />
            </template>
          </PropertyGrid>

          <template #actions>
            <RoleGate :permissions="WRITE_PERMS" :roles="WRITE_ROLES">
              <v-btn
                size="x-small"
                variant="flat"
                color="primary"
                prepend-icon="mdi-pencil"
                @click="selected && openEdit(selected)"
              >
                {{ t('common.edit') }}
              </v-btn>
              <v-btn
                size="x-small"
                variant="text"
                color="error"
                prepend-icon="mdi-delete-outline"
                @click="selected && handleDelete(selected)"
              >
                {{ t('common.delete') }}
              </v-btn>
            </RoleGate>
          </template>
        </DetailsPane>
      </template>
    </WorkspaceSplit>
  </div>
</template>

<style scoped>
.cp-row-actions {
  display: flex;
  justify-content: flex-end;
  gap: 2px;
}
</style>
