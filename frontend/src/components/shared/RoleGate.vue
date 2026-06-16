<script setup lang="ts">
import type { RoleName } from '@/types/enums';
import AccessGate from './AccessGate.vue';

// Backward-compatible wrapper around AccessGate. Existing role-only call sites
// keep working; an optional `permissions` prop makes a call site permission-
// aware without changing the tag. New code should prefer <AccessGate>.
defineProps<{
  roles: RoleName[];
  permissions?: string[];
  mode?: 'hide' | 'disable';
}>();
</script>

<template>
  <AccessGate :roles="roles" :permissions="permissions" :mode="mode">
    <slot />
  </AccessGate>
</template>
