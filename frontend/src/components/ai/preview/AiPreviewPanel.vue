<script setup lang="ts">
// The one chrome for a pending tool preview. Every renderer in the registry
// shares this shell — header, summary, warnings, confirm/cancel — and supplies
// only its own body through the default slot.
//
// It is deliberately NOT a card. The preview docks inside the console's own
// `v-card`, and a card within a card is banned by the design system; the
// separating hairline belongs to `.ai-console__preview`, not to this panel. It is
// also not tinted: Ledger Blue is chrome, never a large fill, and muted ink only
// clears AA on an untinted surface.
import { t } from '@/i18n';

withDefaults(
  defineProps<{
    title: string;
    icon: string;
    summary?: string | null;
    warnings?: readonly string[];
    busy?: boolean;
    /** Overrides the default check icon when the commit has a specific verb. */
    confirmIcon?: string;
  }>(),
  { summary: null, warnings: () => [], busy: false, confirmIcon: 'mdi-check' },
);

defineEmits<{ (e: 'confirm'): void; (e: 'cancel'): void }>();
</script>

<template>
  <section class="ai-preview" :aria-label="title">
    <header class="ai-preview__head">
      <v-icon :icon="icon" size="18" />
      <h2 class="ai-preview__title">{{ title }}</h2>
    </header>

    <p v-if="summary" class="ai-preview__summary">{{ summary }}</p>

    <v-alert
      v-for="(w, i) in warnings"
      :key="i"
      type="warning"
      variant="tonal"
      density="compact"
      class="ai-preview__warning"
    >
      {{ w }}
    </v-alert>

    <slot />

    <div class="ai-preview__actions">
      <v-btn
        color="primary"
        variant="flat"
        size="small"
        :prepend-icon="confirmIcon"
        :loading="busy"
        :disabled="busy"
        @click="$emit('confirm')"
      >
        {{ t('ai.confirm') }}
      </v-btn>
      <v-btn variant="text" size="small" :disabled="busy" @click="$emit('cancel')">
        {{ t('ai.cancel') }}
      </v-btn>
    </div>
  </section>
</template>

<style scoped>
/* One gap owns the vertical rhythm, so no child carries an ad-hoc margin. */
.ai-preview {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ai-preview__head {
  display: flex;
  align-items: center;
  gap: 6px;
}
/* DESIGN.md `title` step. */
.ai-preview__title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -0.005em;
}
.ai-preview__summary {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  text-wrap: pretty;
}
.ai-preview__warning {
  margin: 0;
}
.ai-preview__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
