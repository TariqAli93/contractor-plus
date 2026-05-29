<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{ value: string | Date | null | undefined }>();
const { locale } = useI18n();

const formatted = computed(() => {
  if (!props.value) return '—';
  const d = typeof props.value === 'string' ? new Date(props.value) : props.value;
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(locale.value === 'ar' ? 'ar-LB' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d);
});
</script>

<template><span>{{ formatted }}</span></template>
