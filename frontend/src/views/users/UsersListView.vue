<script setup lang="ts">
// Users workspace: a dense grid on one side, the selected user's property sheet
// on the other. Single click selects (the pane follows), double click opens the
// full record - the Explorer/Access convention. On a window too narrow for two
// panes the single click navigates instead.
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { t } from '@/i18n';
import { useUsers } from '@/composables/useUsers';
import { useConfirm } from '@/composables/useConfirm';
import { useToast } from '@/composables/useToast';
import { useApiError } from '@/composables/useApiError';
import { useAuthStore } from '@/stores/auth.store';
import { useAccess } from '@/composables/useAccess';
import { usersApi } from '@/services/api/users.api';
import { buildUserColumns } from '@/components/features/user/userColumns';
import { RoleName } from '@/types/enums';
import type { User } from '@/types/user';
import SearchBar from '@/components/shared/SearchBar.vue';
import ErrorState from '@/components/shared/ErrorState.vue';
import PageHeader from '@/components/shared/PageHeader.vue';
import DateDisplay from '@/components/shared/DateDisplay.vue';
import DataTable from '@/components/shared/DataTable.vue';
import UserRoleBadge from '@/components/features/user/UserRoleBadge.vue';
import UserStatusBadge from '@/components/features/user/UserStatusBadge.vue';
import ResetPasswordDialog from '@/components/features/user/ResetPasswordDialog.vue';
import WorkspaceSplit from '@/components/shared/workspace/WorkspaceSplit.vue';
import DetailsPane from '@/components/shared/workspace/DetailsPane.vue';
import PropertyGrid from '@/components/shared/workspace/PropertyGrid.vue';
import type { PropertyRow } from '@/components/shared/workspace/types';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const auth = useAuthStore();
const { confirm } = useConfirm();
const { handle } = useApiError();
const { hasRole, hasPermission } = useAccess();

// Per-action permission flags (legacy: USERS_ROLES = OWNER/ADMIN at the route).
const canUpdate = computed(() => hasPermission('users.update'));
const canResetPassword = computed(() => hasPermission('users.reset_password'));
const canToggleActive = computed(() => hasPermission('users.activate'));
const canDelete = computed(() => hasPermission('users.delete'));

const {
  items,
  total,
  loading,
  error,
  page,
  pageSize,
  searchInput,
  roleFilter,
  activeFilter,
  sortBy,
  sortDir,
  fetch,
} = useUsers();

const columns = computed(() => buildUserColumns(t));

const roleItems = computed(() => [
  { value: null, title: t('users.filter.allRoles') },
  ...Object.values(RoleName).map((r) => ({ value: r, title: t(`roles.${r}`) })),
]);
const statusItems = computed(() => [
  { value: null, title: t('users.filter.allStatuses') },
  { value: true, title: t('users.status.active') },
  { value: false, title: t('users.status.inactive') },
]);

const resetTarget = ref<User | null>(null);
const resetOpen = ref(false);

// Selection is mirrored to ?id= so a refresh reopens the same record.
const selectedId = ref<string | null>(
  typeof route.query.id === 'string' ? route.query.id : null,
);
const selected = computed<User | null>(
  () => items.value.find((u) => u.id === selectedId.value) ?? null,
);

onMounted(fetch);

// A non-OWNER cannot act on OWNER accounts (mirrors the backend rule). The
// actor's role identity is read via useAccess; the target's role is data.
function canManage(u: User): boolean {
  if (u.role === RoleName.OWNER && !hasRole(RoleName.OWNER)) return false;
  return true;
}
function isSelf(u: User): boolean {
  return u.id === auth.user?.id;
}

const SORTABLE = new Set(['username', 'fullName', 'lastLoginAt', 'createdAt']);
function onTableUpdate(opts: {
  page: number;
  itemsPerPage: number;
  sortBy: Array<{ key: string; order: 'asc' | 'desc' }>;
}) {
  page.value = opts.page;
  pageSize.value = opts.itemsPerPage;
  const first = opts.sortBy[0];
  if (first && SORTABLE.has(first.key)) {
    sortBy.value = first.key as 'username' | 'fullName' | 'lastLoginAt' | 'createdAt';
    sortDir.value = first.order;
  } else if (opts.sortBy.length === 0) {
    sortBy.value = 'createdAt';
    sortDir.value = 'desc';
  }
}

function openEdit(user: User) {
  void router.push(`/users/${user.id}`);
}

// True when the details pane is actually on screen; WorkspaceSplit owns the rule.
const splitActive = ref(true);

function select(user: User) {
  if (!splitActive.value) {
    if (canManage(user)) openEdit(user);
    return;
  }
  selectedId.value = user.id;
  void router.replace({ query: { ...route.query, id: user.id } });
}

function onRowClick(_e: unknown, row: { item: User }) {
  select(row.item);
}
function onRowDblClick(_e: unknown, row: { item: User }) {
  if (canManage(row.item)) openEdit(row.item);
}

/** Mark the selected row so the grid and the pane agree at a glance. */
function rowProps({ item }: { item: User }) {
  return item.id === selectedId.value ? { class: 'cp-row-selected' } : {};
}

const rows = computed<PropertyRow[]>(() => {
  const u = selected.value;
  if (!u) return [];
  return [
    { key: 'fullName', label: t('users.fields.fullName'), value: u.fullName },
    { key: 'username', label: t('users.fields.username'), value: u.username },
    { key: 'email', label: t('users.fields.email'), value: u.email },
    { key: 'role', label: t('users.fields.role') },
    { key: 'isActive', label: t('users.fields.status') },
    { key: 'lastLoginAt', label: t('users.fields.lastLoginAt'), tabular: true },
  ];
});

function openReset(user: User) {
  resetTarget.value = user;
  resetOpen.value = true;
}

async function toggleActive(user: User) {
  const activate = !user.isActive;
  const ok = await confirm({
    title: activate ? t('users.activateConfirmTitle') : t('users.deactivateConfirmTitle'),
    message: activate
      ? t('users.activateConfirmMessage', { name: user.fullName })
      : t('users.deactivateConfirmMessage', { name: user.fullName }),
    confirmText: activate ? t('users.actions.activate') : t('users.actions.deactivate'),
    destructive: !activate,
  });
  if (!ok) return;
  try {
    if (activate) await usersApi.activate(user.id);
    else await usersApi.deactivate(user.id);
    toast.success(t('common.saved'));
    await fetch();
  } catch (e) {
    handle(e);
  }
}

async function handleDelete(user: User) {
  const ok = await confirm({
    title: t('users.deleteConfirmTitle'),
    message: t('users.deleteConfirmMessage', { name: user.fullName }),
    confirmText: t('common.delete'),
    destructive: true,
  });
  if (!ok) return;
  try {
    await usersApi.remove(user.id);
    toast.success(t('common.deleted'));
    if (selectedId.value === user.id) selectedId.value = null;
    await fetch();
  } catch (e) {
    handle(e);
  }
}
</script>

<template>
  <div class="cp-fill">
    <PageHeader :title="t('nav.users')" :count="total || null" icon="mdi-account-cog-outline">
      <v-btn color="primary" prepend-icon="mdi-account-plus-outline" to="/users/new">
        {{ t('users.new') }}
      </v-btn>
    </PageHeader>

    <WorkspaceSplit storage-key="users" @update:show-details="splitActive = $event">
      <div class="cp-pane">
        <div class="cp-pane__toolbar grid grid-cols-1 md:grid-cols-3 gap-3">
          <SearchBar v-model="searchInput" :placeholder="t('users.searchPlaceholder')" />
          <v-select
            v-model="roleFilter"
            :items="roleItems"
            :label="t('users.fields.role')"
            density="comfortable"
            hide-details
          />
          <v-select
            v-model="activeFilter"
            :items="statusItems"
            :label="t('users.fields.status')"
            density="comfortable"
            hide-details
          />
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
            <template #[`item.role`]="{ item }">
              <UserRoleBadge :role="item.role" />
            </template>
            <template #[`item.isActive`]="{ item }">
              <UserStatusBadge :active="item.isActive" />
            </template>
            <template #[`item.lastLoginAt`]="{ item }">
              <DateDisplay :value="item.lastLoginAt" />
            </template>
            <template #[`item.actions`]="{ item }">
              <div class="flex justify-end gap-1" @click.stop>
                <template v-if="canManage(item)">
                  <v-tooltip v-if="canUpdate" :text="t('common.edit')" location="top">
                    <template #activator="{ props }">
                      <v-btn v-bind="props" icon="mdi-pencil" size="small" variant="text" :aria-label="t('common.edit')" @click="openEdit(item)" />
                    </template>
                  </v-tooltip>
                  <v-tooltip v-if="canResetPassword" :text="t('users.actions.resetPassword')" location="top">
                    <template #activator="{ props }">
                      <v-btn v-bind="props" icon="mdi-lock-reset" size="small" variant="text" :aria-label="t('users.actions.resetPassword')" @click="openReset(item)" />
                    </template>
                  </v-tooltip>
                  <v-tooltip
                    v-if="canToggleActive"
                    :text="item.isActive ? t('users.actions.deactivate') : t('users.actions.activate')"
                    location="top"
                  >
                    <template #activator="{ props }">
                      <v-btn
                        v-bind="props"
                        :icon="item.isActive ? 'mdi-account-off-outline' : 'mdi-account-check-outline'"
                        size="small"
                        variant="text"
                        :color="item.isActive ? 'warning' : 'success'"
                        :disabled="isSelf(item) && item.isActive"
                        @click="toggleActive(item)"
                      />
                    </template>
                  </v-tooltip>
                  <v-tooltip v-if="canDelete" :text="t('common.delete')" location="top">
                    <template #activator="{ props }">
                      <v-btn
                        v-bind="props"
                        icon="mdi-delete-outline"
                        size="small"
                        variant="text"
                        color="error"
                        :disabled="isSelf(item)"
                        @click="handleDelete(item)"
                      />
                    </template>
                  </v-tooltip>
                </template>
                <v-icon v-else icon="mdi-lock-outline" size="small" class="text-medium-emphasis" />
              </div>
            </template>
          </DataTable>
        </div>
      </div>

      <template #details>
        <DetailsPane
          :title="selected?.fullName ?? t('details.title')"
          icon="mdi-account-cog-outline"
          :selected="Boolean(selected)"
        >
          <PropertyGrid :rows="rows">
            <template #role>
              <UserRoleBadge v-if="selected" :role="selected.role" />
            </template>
            <template #isActive>
              <UserStatusBadge v-if="selected" :active="selected.isActive" />
            </template>
            <template #lastLoginAt>
              <DateDisplay :value="selected?.lastLoginAt" />
            </template>
          </PropertyGrid>

          <template #actions>
            <template v-if="selected && canManage(selected)">
              <v-btn
                v-if="canUpdate"
                size="x-small"
                variant="flat"
                color="primary"
                prepend-icon="mdi-pencil"
                @click="selected && openEdit(selected)"
              >
                {{ t('common.edit') }}
              </v-btn>
              <v-btn
                v-if="canResetPassword"
                size="x-small"
                variant="text"
                prepend-icon="mdi-lock-reset"
                @click="selected && openReset(selected)"
              >
                {{ t('users.actions.resetPassword') }}
              </v-btn>
              <v-btn
                v-if="canToggleActive"
                size="x-small"
                variant="text"
                :color="selected.isActive ? 'warning' : 'success'"
                :prepend-icon="selected.isActive ? 'mdi-account-off-outline' : 'mdi-account-check-outline'"
                :disabled="isSelf(selected) && selected.isActive"
                @click="selected && toggleActive(selected)"
              >
                {{ selected.isActive ? t('users.actions.deactivate') : t('users.actions.activate') }}
              </v-btn>
              <v-btn
                v-if="canDelete"
                size="x-small"
                variant="text"
                color="error"
                prepend-icon="mdi-delete-outline"
                :disabled="isSelf(selected)"
                @click="selected && handleDelete(selected)"
              >
                {{ t('common.delete') }}
              </v-btn>
            </template>
          </template>
        </DetailsPane>
      </template>
    </WorkspaceSplit>

    <ResetPasswordDialog v-model="resetOpen" :user="resetTarget" @done="fetch" />
  </div>
</template>
