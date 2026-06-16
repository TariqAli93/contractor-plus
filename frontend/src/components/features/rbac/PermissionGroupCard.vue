<script setup lang="ts">
import { computed } from 'vue';
import { t, te } from '@/i18n';
import type { Permission } from '@/types/rbac';
import PermissionToggle from './PermissionToggle.vue';

const props = defineProps<{
  moduleKey: string;
  permissions: Permission[];
  selected: Set<string>;
  disabled?: boolean;
}>();
const emit = defineEmits<{ (e: 'toggle', key: string, value: boolean): void }>();

const title = computed(() => {
  const key = `permissionGroups.${props.moduleKey}`;
  return te(key) ? t(key) : props.moduleKey;
});

const allOn = computed(() => props.permissions.every((p) => props.selected.has(p.key)));

function toggleAll(v: boolean) {
  if (props.disabled) return;
  for (const p of props.permissions) emit('toggle', p.key, v);
}
</script>

<template>
  <v-card variant="outlined">
    <div class="flex items-center justify-between px-4 py-2">
      <span class="text-subtitle-2 font-medium">{{ title }}</span>
      <v-btn
        v-if="!disabled"
        size="x-small"
        variant="text"
        @click="toggleAll(!allOn)"
      >
        {{ allOn ? t('rbac.clearAll') : t('rbac.selectAll') }}
      </v-btn>
    </div>
    <v-divider />
    <div class="px-4 py-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4">
      <PermissionToggle
        v-for="perm in permissions"
        :key="perm.key"
        :model-value="selected.has(perm.key)"
        :label="perm.displayName"
        :disabled="disabled"
        @update:model-value="(v) => emit('toggle', perm.key, v)"
      />
    </div>
  </v-card>
</template>
