<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
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
import DateDisplay from '@/components/shared/DateDisplay.vue';
import UserRoleBadge from '@/components/features/user/UserRoleBadge.vue';
import UserStatusBadge from '@/components/features/user/UserStatusBadge.vue';
import ResetPasswordDialog from '@/components/features/user/ResetPasswordDialog.vue';

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
function onRowClick(_e: unknown, row: { item: User }) {
  if (canManage(row.item)) openEdit(row.item);
}

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
    await fetch();
  } catch (e) {
    handle(e);
  }
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-4 gap-2 flex-wrap">
      <h1 class="text-h5">{{ t('nav.users') }}</h1>
      <v-btn color="primary" prepend-icon="mdi-account-plus-outline" to="/users/new">
        {{ t('users.new') }}
      </v-btn>
    </div>

    <v-card>
      <v-card-text class="grid grid-cols-1 md:grid-cols-3 gap-3">
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
                  <v-btn v-bind="props" icon="mdi-pencil" size="small" variant="text" @click="openEdit(item)" />
                </template>
              </v-tooltip>
              <v-tooltip v-if="canResetPassword" :text="t('users.actions.resetPassword')" location="top">
                <template #activator="{ props }">
                  <v-btn v-bind="props" icon="mdi-lock-reset" size="small" variant="text" @click="openReset(item)" />
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
      </v-data-table-server>
    </v-card>

    <ResetPasswordDialog v-model="resetOpen" :user="resetTarget" @done="fetch" />
  </div>
</template>
