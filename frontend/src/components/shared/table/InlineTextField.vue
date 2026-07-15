<script setup lang="ts">
// Thin VTextField/VTextarea wrapper for inline table editing: compact, outlined,
// error-bound, with the RTL fix for numeric/temporal inputs (digits, the minus
// sign and the caret read left-to-right inside the RTL shell). It is a plain
// control, not a config engine - the page decides which field uses it.
import { computed } from 'vue';

type Kind = 'text' | 'number' | 'money' | 'date' | 'datetime' | 'multiline';

const props = withDefaults(
  defineProps<{
    /** Field name; sets `data-field` so validation can focus the first invalid. */
    field: string;
    modelValue: unknown;
    kind?: Kind;
    label?: string;
    placeholder?: string;
    error?: string | null;
    step?: number;
    min?: number;
    autofocus?: boolean;
  }>(),
  { kind: 'text' },
);

const emit = defineEmits<{ (e: 'update:modelValue', value: unknown): void }>();

const asString = computed(() => (props.modelValue == null ? '' : String(props.modelValue)));
const errorMessages = computed(() => (props.error ? [props.error] : []));
const ltr = computed(() => ['number', 'money', 'date', 'datetime'].includes(props.kind));
const inputType = computed(() =>
  props.kind === 'number' || props.kind === 'money'
    ? 'number'
    : props.kind === 'date'
      ? 'date'
      : props.kind === 'datetime'
        ? 'datetime-local'
        : 'text',
);
</script>

<template>
  <div class="cp-inline-field" :data-field="field">
    <v-textarea
      v-if="kind === 'multiline'"
      :model-value="asString"
      :label="label"
      :placeholder="placeholder"
      :error-messages="errorMessages"
      :autofocus="autofocus"
      rows="1"
      auto-grow
      density="compact"
      variant="outlined"
      hide-details="auto"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <v-text-field
      v-else
      :model-value="asString"
      :label="label"
      :placeholder="placeholder"
      :type="inputType"
      :step="step"
      :min="min"
      :error-messages="errorMessages"
      :autofocus="autofocus"
      :class="{ 'cp-inline-num': ltr }"
      density="compact"
      variant="outlined"
      hide-details="auto"
      @update:model-value="emit('update:modelValue', $event)"
    />
  </div>
</template>

<style scoped>
.cp-inline-field {
  min-width: 96px;
}
/* Digits read LTR and lose the spinner even inside the RTL shell. Right-aligned
   so an editing money/number cell lines up with its display column. */
.cp-inline-num :deep(input) {
  direction: ltr;
  text-align: end;
  font-variant-numeric: tabular-nums;
}
.cp-inline-num :deep(input[type='number']) {
  appearance: textfield;
}
.cp-inline-num :deep(input[type='number']::-webkit-outer-spin-button),
.cp-inline-num :deep(input[type='number']::-webkit-inner-spin-button) {
  appearance: none;
  margin: 0;
}
</style>
