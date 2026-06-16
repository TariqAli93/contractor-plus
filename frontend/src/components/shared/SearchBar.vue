<script setup lang="ts">
import { t } from '@/i18n';

const props = defineProps<{ modelValue: string; placeholder?: string }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>();

function onInput(v: string) {
  emit('update:modelValue', v);
}
</script>

<template>
  <v-text-field
    :model-value="props.modelValue"
    :placeholder="placeholder ?? t('common.search')"
    prepend-inner-icon="mdi-magnify"
    hide-details
    clearable
    density="comfortable"
    @update:model-value="onInput"
  />
</template>
