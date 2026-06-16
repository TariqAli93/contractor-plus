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
  <div>
    <v-alert type="info" variant="tonal" density="comfortable" class="mb-4 text-body-2">
      {{ t('rbac.systemNote') }}
    </v-alert>

    <div class="flex justify-end mb-3">
      <v-btn
        v-if="canManage"
        color="primary"
        prepend-icon="mdi-shield-plus-outline"
        @click="emit('create')"
      >
        {{ t('rbac.createRole') }}
      </v-btn>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <v-card v-for="role in roles" :key="role.id" variant="outlined">
        <v-card-text>
          <div class="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <RoleBadge :name="role.name" :display-name="role.displayName" :is-system="role.isSystem" />
            <div class="flex gap-1">
              <v-chip v-if="role.isSystem" size="x-small" variant="tonal" color="blue-grey">
                {{ t('rbac.systemRole') }}
              </v-chip>
              <v-chip v-if="role.isProtected" size="x-small" variant="tonal" color="amber-darken-2">
                {{ t('rbac.protected') }}
              </v-chip>
              <v-chip v-if="!role.isActive" size="x-small" variant="tonal" color="error">
                {{ t('users.status.inactive') }}
              </v-chip>
            </div>
          </div>
          <div class="text-subtitle-1 font-medium">{{ role.displayName ?? role.name }}</div>
          <div class="text-body-2 text-medium-emphasis mt-1">{{ role.description ?? '—' }}</div>
          <div class="text-caption text-medium-emphasis mt-2 flex gap-4">
            <span>{{ t('rbac.userCount', { n: role.userCount }) }}</span>
            <span>{{ t('rbac.permissionCount', { n: role.permissionCount }) }}</span>
          </div>
        </v-card-text>
        <v-divider />
        <v-card-actions class="px-3 py-2">
          <v-spacer />
          <template v-if="canManage">
            <v-btn size="small" variant="text" prepend-icon="mdi-key-outline" @click="emit('editPermissions', role)">
              {{ t('rbac.permissions') }}
            </v-btn>
            <v-btn size="small" variant="text" prepend-icon="mdi-pencil" @click="emit('edit', role)">
              {{ t('rbac.editMetadata') }}
            </v-btn>
            <v-btn
              v-if="!role.isSystem && !role.isProtected"
              size="small"
              variant="text"
              color="error"
              prepend-icon="mdi-delete-outline"
              :disabled="role.userCount > 0"
              @click="emit('delete', role)"
            >
              {{ t('common.delete') }}
            </v-btn>
          </template>
        </v-card-actions>
      </v-card>
    </div>
  </div>
</template>
