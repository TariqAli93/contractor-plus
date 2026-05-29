<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const props = defineProps<{ modelValue: string; placeholder?: string }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>();
const { t } = useI18n();

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
