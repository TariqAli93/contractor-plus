<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  value: number | string;
  height?: number;
  showLabel?: boolean;
  color?: string;
}>();

const pct = computed(() => {
  const n = typeof props.value === 'string' ? Number(props.value) : props.value;
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
});
// The bar can fill fractionally; the label reads as a whole percent.
const label = computed(() => Math.round(pct.value));
</script>

<template>
  <v-progress-linear
    :model-value="pct"
    :height="height ?? 8"
    :color="color ?? 'primary'"
  >
    <template v-if="showLabel" #default>
      <span class="text-caption font-medium cp-tnum">{{ label }}%</span>
    </template>
  </v-progress-linear>
</template>
