<script setup lang="ts">
import { computed } from 'vue';
import { useCurrencyFormat } from '@/composables/useCurrencyFormat';

const props = defineProps<{
  amount: number | string | null | undefined;
  // Legacy override — when provided, this string is shown next to the
  // formatted number instead of the default currency symbol. Existing
  // call sites that pass a code (e.g. "USD") keep working unchanged.
  currency?: string;
  // Hide the currency symbol/code entirely (useful in tight tables).
  hideSymbol?: boolean;
}>();

const { format } = useCurrencyFormat();

// When the caller passed a manual `currency` string, render the number
// without the default symbol and append the legacy chip in its own span —
// preserving the visual contract of the previous component.
const showLegacyChip = computed(() => Boolean(props.currency));

const formatted = computed(() =>
  format(props.amount, {
    hideSymbol: props.hideSymbol || showLegacyChip.value,
  }),
);
</script>

<template>
  <span class="cp-money">
    {{ formatted }}
    <span
      v-if="showLegacyChip && !hideSymbol"
      class="text-medium-emphasis text-xs ms-1"
    >
      {{ currency }}
    </span>
  </span>
</template>

<style scoped>
.cp-money {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
