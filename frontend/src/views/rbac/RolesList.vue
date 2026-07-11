<script setup lang="ts">
import { t } from '@/i18n';
import { useAccess } from '@/composables/useAccess';
import type { Role } from '@/types/rbac';
import RoleBadge from '@/components/features/rbac/RoleBadge.vue';

defineProps<{ roles: Role[] }>();
const emit = defineEmits<{
  (e: 'create'): void;
  (e: 'edit', role: Role): void;
  (e: 'editPermissions', role: Role): void;
  (e: 'delete', role: Role): void;
}>();

const { hasPermission } = useAccess();
const canManage = hasPermission('rbac.manage');
</script>

<template>
  <section class="cp-roles">
    <div class="cp-roles__toolbar">
      <span>{{ t('rbac.systemNote') }}</span>
      <v-btn
        v-if="canManage"
        color="primary"
        size="small"
        prepend-icon="mdi-shield-plus-outline"
        @click="emit('create')"
      >
        {{ t('rbac.createRole') }}
      </v-btn>
    </div>

    <v-table class="cp-roles__table">
      <thead>
        <tr>
          <th>{{ t('rbac.rolesTab') }}</th>
          <th>{{ t('common.details') }}</th>
          <th class="text-end">{{ t('rbac.userCount', { n: '' }) }}</th>
          <th class="text-end">{{ t('rbac.permissionCount', { n: '' }) }}</th>
          <th class="text-end">{{ t('common.details') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="role in roles" :key="role.id">
          <td>
            <RoleBadge :name="role.name" :display-name="role.displayName" :is-system="role.isSystem" />
            <div class="cp-roles__name">{{ role.displayName ?? role.name }}</div>
          </td>
          <td>
            <span>{{ role.description ?? '-' }}</span>
            <span class="cp-roles__flags">
              <v-chip v-if="role.isSystem" size="x-small" variant="tonal" color="info">
                {{ t('rbac.systemRole') }}
              </v-chip>
              <v-chip v-if="role.isProtected" size="x-small" variant="tonal" color="warning">
                {{ t('rbac.protected') }}
              </v-chip>
              <v-chip v-if="!role.isActive" size="x-small" variant="tonal" color="error">
                {{ t('users.status.inactive') }}
              </v-chip>
            </span>
          </td>
          <td class="text-end tabular-nums">{{ role.userCount }}</td>
          <td class="text-end tabular-nums">{{ role.permissionCount }}</td>
          <td class="text-end">
            <template v-if="canManage">
            <v-btn size="x-small" variant="text" prepend-icon="mdi-key-outline" @click="emit('editPermissions', role)">
              {{ t('rbac.permissions') }}
            </v-btn>
            <v-btn size="x-small" variant="text" prepend-icon="mdi-pencil" @click="emit('edit', role)">
              {{ t('rbac.editMetadata') }}
            </v-btn>
            <v-btn
              v-if="!role.isSystem && !role.isProtected"
              size="x-small"
              variant="text"
              color="error"
              prepend-icon="mdi-delete-outline"
              :disabled="role.userCount > 0"
              @click="emit('delete', role)"
            >
              {{ t('common.delete') }}
            </v-btn>
            </template>
          </td>
        </tr>
      </tbody>
    </v-table>
  </section>
</template>

<style scoped>
.cp-roles__toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 4px 8px;
  color: var(--cp-text-muted);
  background: var(--cp-surface-2);
  border-block-end: 1px solid var(--cp-border);
  font-size: 0.72rem;
}
.cp-roles__toolbar .v-btn { margin-inline-start: auto; }
.cp-roles__table { width: 100%; }
.cp-roles__name { margin-top: 2px; font-weight: 600; }
.cp-roles__flags { display: inline-flex; gap: 3px; margin-inline-start: 6px; vertical-align: middle; }
</style>
