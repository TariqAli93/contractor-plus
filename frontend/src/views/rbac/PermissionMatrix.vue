<script setup lang="ts">
import { t, te } from '@/i18n';
import type { PermissionMatrix } from '@/types/rbac';
import PermissionBadge from '@/components/features/rbac/PermissionBadge.vue';
import RoleBadge from '@/components/features/rbac/RoleBadge.vue';

const props = defineProps<{ matrix: PermissionMatrix }>();

function moduleTitle(key: string): string {
  const k = `permissionGroups.${key}`;
  return te(k) ? t(k) : key;
}
void props;
</script>

<template>
  <div>
    <v-alert type="info" variant="tonal" density="comfortable" class="mb-4 text-body-2">
      {{ t('rbac.matrixNote') }}
    </v-alert>

    <v-card v-for="mod in matrix.modules" :key="mod.key" variant="outlined" class="mb-4">
      <v-card-title class="text-subtitle-1 font-medium">{{ moduleTitle(mod.key) }}</v-card-title>
      <v-divider />
      <v-table density="comfortable">
        <thead>
          <tr>
            <th class="text-start">{{ t('rbac.permission') }}</th>
            <th v-for="role in matrix.roles" :key="role.id" class="text-center">
              <RoleBadge :name="role.name" :display-name="role.displayName" :is-system="role.isSystem" size="x-small" />
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="perm in mod.permissions" :key="perm.key">
            <td>{{ perm.displayName }}</td>
            <td v-for="role in matrix.roles" :key="role.id" class="text-center">
              <PermissionBadge :allowed="matrix.cells[role.name]?.[perm.key] ?? false" />
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card>
  </div>
</template>
