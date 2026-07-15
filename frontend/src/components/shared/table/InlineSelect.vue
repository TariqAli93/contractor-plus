<script setup lang="ts">
// Thin VSelect / VAutocomplete wrapper for inline table editing. Same compact,
// outlined, error-bound treatment as InlineTextField.
import { computed } from 'vue';

export interface InlineSelectOption {
  value: string | number | boolean;
  title: string;
}

const props = defineProps<{
  field: string;
  modelValue: unknown;
  items: readonly InlineSelectOption[];
  /** Use an autocomplete (searchable) instead of a plain select. */
  autocomplete?: boolean;
  label?: string;
  placeholder?: string;
  error?: string | null;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', value: unknown): void }>();

const errorMessages = computed(() => (props.error ? [props.error] : []));
</script>

<template>
  <div class="cp-inline-field" :data-field="field">
    <v-autocomplete
      v-if="autocomplete"
      :model-value="modelValue"
      :items="items"
      :label="label"
      :placeholder="placeholder"
      :error-messages="errorMessages"
      item-title="title"
      item-value="value"
      auto-select-first
      density="compact"
      variant="outlined"
      hide-details="auto"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <v-select
      v-else
      :model-value="modelValue"
      :items="items"
      :label="label"
      :placeholder="placeholder"
      :error-messages="errorMessages"
      item-title="title"
      item-value="value"
      density="compact"
      variant="outlined"
      hide-details="auto"
      @update:model-value="emit('update:modelValue', $event)"
    />
  </div>
</template>

<style scoped>
.cp-inline-field {
  min-width: 120px;
}
</style>
