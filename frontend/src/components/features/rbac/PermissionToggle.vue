<script setup lang="ts">
defineProps<{ modelValue: boolean; label: string; description?: string | null; disabled?: boolean }>();
defineEmits<{ (e: 'update:modelValue', v: boolean): void }>();
</script>

<template>
  <v-switch
    :model-value="modelValue"
    :label="label"
    :disabled="disabled"
    color="primary"
    density="compact"
    hide-details
    inset
    @update:model-value="$emit('update:modelValue', Boolean($event))"
  />
</template>
