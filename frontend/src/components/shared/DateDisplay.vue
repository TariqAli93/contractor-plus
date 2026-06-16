<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ value: string | Date | null | undefined }>();

const formatted = computed(() => {
  if (!props.value) return '—';
  const d = typeof props.value === 'string' ? new Date(props.value) : props.value;
  if (Number.isNaN(d.getTime())) return '—';
  // Arabic-only app: always format dates with the Arabic (Gregorian) locale.
  return new Intl.DateTimeFormat('ar-LB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d);
});
</script>

<template><span>{{ formatted }}</span></template>
