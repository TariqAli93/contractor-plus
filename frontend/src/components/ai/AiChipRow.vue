<script setup lang="ts">
// The console's one chip-row affordance. Empty-state examples, an answer's
// suggestions, and a live question's options are all the same gesture — a phrase
// you click to say it — so they are the same control, not three lookalikes.
//
// Rendered as real <button>s on purpose: Vuetify only treats a chip as clickable
// when it is a link, has a `to`/`href`, or sits in a chip-group, so a chip
// carrying only an @click is mouse-only — no tabindex, no key handler, and (via
// `.v-chip--link`) no pointer cursor or hover overlay.
//
// `tag="button"` restores the native semantics AT and keyboard users need;
// `link` restores the clickable styling and the Enter/Space handler. They don't
// double-fire: VChip's keydown calls preventDefault() before re-emitting, which
// suppresses the button's own activation click.
withDefaults(
  defineProps<{
    items: readonly string[];
    /** `center` under the empty state, `start` inside a bubble. */
    align?: 'start' | 'center';
    disabled?: boolean;
  }>(),
  { align: 'start', disabled: false },
);

defineEmits<{ (e: 'select', value: string): void }>();
</script>

<template>
  <div v-if="items.length" class="ai-chips" :class="`ai-chips--${align}`">
    <v-chip
      v-for="(item, i) in items"
      :key="i"
      link
      tag="button"
      type="button"
      size="small"
      variant="tonal"
      :disabled="disabled"
      @click="$emit('select', item)"
    >
      {{ item }}
    </v-chip>
  </div>
</template>

<style scoped>
.ai-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
/* `flex-start` follows the writing direction, so this stays correct under RTL. */
.ai-chips--start {
  justify-content: flex-start;
}
.ai-chips--center {
  justify-content: center;
}

/* A <button> takes the UA font, not the app's. Size/weight stay Vuetify's. */
.ai-chips :deep(.v-chip) {
  font-family: inherit;
}
/* Same focus ring as every other keyboard target in the app (.cp-row-button). */
.ai-chips :deep(.v-chip:focus-visible) {
  outline: 2px solid var(--cp-primary);
  outline-offset: -2px;
}
</style>
