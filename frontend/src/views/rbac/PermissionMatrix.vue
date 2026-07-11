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
  <div class="cp-matrix">
    <div class="cp-matrix__note">{{ t('rbac.matrixNote') }}</div>

    <section v-for="mod in matrix.modules" :key="mod.key" class="cp-panel cp-matrix__module">
      <h2 class="cp-matrix__title">{{ moduleTitle(mod.key) }}</h2>
      <v-table>
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
    </section>
  </div>
</template>

<style scoped>
.cp-matrix { padding: 6px; overflow: auto; }
.cp-matrix__note {
  padding: 5px 8px;
  margin-bottom: 6px;
  color: var(--cp-text-muted);
  background: var(--cp-surface-2);
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius-sm);
  font-size: 0.72rem;
}
.cp-matrix__module { margin-bottom: 6px; overflow: hidden; }
.cp-matrix__title {
  margin: 0;
  padding: 5px 8px;
  color: var(--cp-text);
  background: var(--cp-surface-2);
  border-block-end: 1px solid var(--cp-border);
  font-size: 0.78rem;
  font-weight: 600;
}
</style>
