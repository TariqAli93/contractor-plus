<script setup lang="ts">
import { computed } from 'vue';
import { useAccess, type AccessSpec } from '@/composables/useAccess';

// Hybrid visibility gate. Renders the slot when the user satisfies the access
// spec (permission-first, legacy-role fallback, OWNER always). `mode="disable"`
// keeps the slot visible but inert. UI-only - the backend still enforces.
const props = defineProps<{
  permissions?: string[];
  roles?: string[];
  match?: 'any' | 'all';
  mode?: 'hide' | 'disable';
}>();

const { canAccess } = useAccess();

const spec = computed<AccessSpec>(() => ({
  permissions: props.permissions,
  roles: props.roles,
  mode: props.match ?? 'any',
}));
const allowed = computed(() => canAccess(spec.value));
const mode = computed(() => props.mode ?? 'hide');
</script>

<template>
  <template v-if="allowed">
    <slot />
  </template>
  <template v-else-if="mode === 'disable'">
    <div class="opacity-50 pointer-events-none">
      <slot />
    </div>
  </template>
</template>
