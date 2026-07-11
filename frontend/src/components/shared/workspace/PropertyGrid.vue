<script setup lang="ts">
// A property sheet: label/value pairs on a hairline grid, optionally split into
// named sections. This is the vocabulary of the details pane - no cards, no
// spacing rhythm, just ruled rows you can scan a record down.
//
// A caller overrides any row by supplying a `#<row.key>` slot, so it can drop in
// a MoneyDisplay, a status badge, or a link without this component knowing about
// any of them.
import type { PropertyRow } from './types';

defineProps<{
  rows: readonly PropertyRow[];
  /** Optional heading rendered above the block. */
  section?: string | null;
}>();

defineSlots<{
  [key: string]: (props: { row: PropertyRow }) => unknown;
}>();

/** An empty value is a dash, never a blank cell - a blank reads as "loading". */
function display(row: PropertyRow): string {
  if (row.value === null || row.value === undefined || row.value === '') return '-';
  return String(row.value);
}
</script>

<template>
  <section class="cp-props">
    <h3 v-if="section" class="cp-props__section">{{ section }}</h3>
    <dl class="cp-props__grid">
      <template v-for="row in rows" :key="row.key">
        <dt class="cp-props__label">{{ row.label }}</dt>
        <dd class="cp-props__value" :class="{ 'cp-props__value--tabular': row.tabular }">
          <slot :name="row.key" :row="row">{{ display(row) }}</slot>
        </dd>
      </template>
    </dl>
  </section>
</template>

<style scoped>
.cp-props {
  display: block;
}
/* A quiet organizing device, used sparingly - not an eyebrow on every block. */
.cp-props__section {
  margin: 0;
  padding: 5px 8px;
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--cp-text-subtle);
  background: var(--cp-surface-2);
  border-block-end: 1px solid var(--cp-border);
}
.cp-props__grid {
  display: grid;
  /* The label column sizes to the longest label, then stops. */
  grid-template-columns: minmax(72px, max-content) 1fr;
  margin: 0;
}
.cp-props__label,
.cp-props__value {
  margin: 0;
  padding: 4px 8px;
  font-size: 0.76rem;
  line-height: 1.4;
  border-block-end: 1px solid var(--cp-border);
  min-height: var(--cp-row-h);
  display: flex;
  align-items: center;
}
.cp-props__label {
  color: var(--cp-text-muted);
  background: var(--cp-surface-2);
  border-inline-end: 1px solid var(--cp-border);
}
.cp-props__value {
  color: var(--cp-text);
  overflow-wrap: anywhere;
}
.cp-props__value--tabular {
  font-variant-numeric: tabular-nums;
}
</style>
