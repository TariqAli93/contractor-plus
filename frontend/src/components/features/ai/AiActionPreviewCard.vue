<script setup lang="ts">
// Renders a proposed action's preview: the fields that will be created, or the
// old→new changes for an update, plus any warnings. Read-only — the write only
// happens on explicit confirm.
import type { PendingAction } from '@/types/aiActions';

defineProps<{ action: PendingAction }>();
</script>

<template>
  <div class="cp-preview">
    <p class="cp-preview__summary">{{ action.preview.summary }}</p>

    <dl v-if="action.preview.fields.length" class="cp-preview__fields">
      <template v-for="f in action.preview.fields" :key="f.label">
        <dt>{{ f.label }}</dt>
        <dd>{{ f.value }}</dd>
      </template>
    </dl>

    <div v-if="action.preview.changes && action.preview.changes.length" class="cp-preview__changes">
      <div v-for="c in action.preview.changes" :key="c.label" class="cp-preview__change">
        <span class="cp-preview__change-label">{{ c.label }}</span>
        <span class="cp-preview__old">{{ c.oldValue }}</span>
        <v-icon size="14" class="cp-preview__arrow">mdi-arrow-left</v-icon>
        <span class="cp-preview__new">{{ c.newValue }}</span>
      </div>
    </div>

    <v-alert
      v-for="(w, i) in action.preview.warnings"
      :key="i"
      type="warning"
      variant="tonal"
      density="compact"
      class="cp-preview__warn"
    >
      {{ w }}
    </v-alert>
  </div>
</template>

<style scoped>
.cp-preview__summary {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--cp-text);
  margin-bottom: 10px;
}
.cp-preview__fields {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 12px;
  margin: 0 0 8px;
  font-size: 0.84rem;
}
.cp-preview__fields dt {
  color: var(--cp-text-muted);
  font-size: 0.76rem;
  align-self: center;
}
.cp-preview__fields dd {
  margin: 0;
  color: var(--cp-text);
  overflow-wrap: anywhere;
}
.cp-preview__changes {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 8px;
}
.cp-preview__change {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 0.84rem;
}
.cp-preview__change-label {
  color: var(--cp-text-muted);
  font-size: 0.76rem;
  min-width: 8rem;
}
.cp-preview__old {
  color: var(--cp-text-muted);
  text-decoration: line-through;
}
.cp-preview__new {
  color: var(--cp-text);
  font-weight: 600;
}
.cp-preview__arrow {
  color: var(--cp-text-subtle);
}
.cp-preview__warn {
  margin-top: 6px;
}
</style>
