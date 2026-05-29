<script setup lang="ts">
import { computed } from 'vue';
import { useCan } from '@/composables/useCan';
import type { RoleName } from '@/types/enums';

const props = defineProps<{
  roles: RoleName[];
  mode?: 'hide' | 'disable';
}>();

const { can } = useCan();
const allowed = computed(() => can(props.roles));
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
