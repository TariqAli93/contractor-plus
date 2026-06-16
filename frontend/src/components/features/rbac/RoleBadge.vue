<script setup lang="ts">
import { computed } from 'vue';
import { t, te } from '@/i18n';

const props = defineProps<{
  name: string;
  displayName?: string | null;
  isSystem?: boolean;
  size?: 'x-small' | 'small' | 'default' | 'large';
}>();

// Prefer the stored displayName, fall back to a known i18n label, then the raw
// name (custom roles).
const label = computed(() => {
  if (props.displayName) return props.displayName;
  const key = `roles.${props.name}`;
  return te(key) ? t(key) : props.name;
});

const color = computed(() => (props.isSystem ? 'primary' : 'teal'));
</script>

<template>
  <v-chip :color="color" :size="size ?? 'small'" variant="tonal">
    {{ label }}
  </v-chip>
</template>
