<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { t } from '@/i18n';
import { rbacApi } from '@/services/api/rbac.api';
import { useApiError } from '@/composables/useApiError';
import { useConfirm } from '@/composables/useConfirm';
import { useToast } from '@/composables/useToast';
import type { PermissionMatrix as PermissionMatrixData, Role } from '@/types/rbac';
import ErrorState from '@/components/shared/ErrorState.vue';
import PageHeader from '@/components/shared/PageHeader.vue';
import RolesList from './RolesList.vue';
import PermissionMatrix from './PermissionMatrix.vue';
import RoleEditDialog from '@/components/features/rbac/RoleEditDialog.vue';
import RolePermissionsDialog from '@/components/features/rbac/RolePermissionsDialog.vue';

const { handle } = useApiError();
const { confirm } = useConfirm();
const toast = useToast();

const activeTab = ref<'roles' | 'matrix'>('roles');
const roles = ref<Role[]>([]);
const matrix = ref<PermissionMatrixData | null>(null);
const loading = ref(false);
const error = ref<unknown>(null);

const editOpen = ref(false);
const editTarget = ref<Role | null>(null);
const permsOpen = ref(false);
const permsTarget = ref<Role | null>(null);

async function fetch() {
  loading.value = true;
  error.value = null;
  try {
    const [r, m] = await Promise.all([rbacApi.listRoles(), rbacApi.getMatrix()]);
    roles.value = r;
    matrix.value = m;
  } catch (e) {
    error.value = e;
    handle(e);
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editTarget.value = null;
  editOpen.value = true;
}
function openEdit(role: Role) {
  editTarget.value = role;
  editOpen.value = true;
}
function openPerms(role: Role) {
  permsTarget.value = role;
  permsOpen.value = true;
}

async function onDelete(role: Role) {
  const ok = await confirm({
    title: t('rbac.deleteConfirmTitle'),
    message: t('rbac.deleteConfirmMessage', { name: role.displayName ?? role.name }),
    confirmText: t('common.delete'),
    destructive: true,
  });
  if (!ok) return;
  try {
    await rbacApi.deleteRole(role.id);
    toast.success(t('common.deleted'));
    await fetch();
  } catch (e) {
    handle(e);
  }
}

onMounted(fetch);
</script>

<template>
  <div>
    <PageHeader :title="t('nav.rbac')" icon="mdi-shield-key-outline" />
    <p class="text-medium-emphasis text-body-2 mb-4">{{ t('rbac.intro') }}</p>

    <v-tabs v-model="activeTab" color="primary" density="comfortable" class="mb-4">
      <v-tab value="roles" prepend-icon="mdi-shield-account-outline">{{ t('rbac.rolesTab') }}</v-tab>
      <v-tab value="matrix" prepend-icon="mdi-table-lock">{{ t('rbac.matrixTab') }}</v-tab>
    </v-tabs>

    <ErrorState v-if="error" :error="error" @retry="fetch" />
    <v-progress-linear v-else-if="loading && roles.length === 0" indeterminate />

    <v-window v-else v-model="activeTab">
      <v-window-item value="roles">
        <RolesList
          :roles="roles"
          @create="openCreate"
          @edit="openEdit"
          @edit-permissions="openPerms"
          @delete="onDelete"
        />
      </v-window-item>
      <v-window-item value="matrix">
        <PermissionMatrix v-if="matrix" :matrix="matrix" />
      </v-window-item>
    </v-window>

    <RoleEditDialog v-model="editOpen" :role="editTarget" @saved="fetch" />
    <RolePermissionsDialog
      v-model="permsOpen"
      :role="permsTarget"
      :modules="matrix?.modules ?? []"
      @saved="fetch"
    />
  </div>
</template>
