<script setup lang="ts">
// The properties pane: what Access calls a property sheet and Visual Studio the
// Properties window. It shows the selected record, nothing else. It never
// becomes a second page, and it never floats - it is a docked column bounded by
// a hairline.
//
// With no selection it says so plainly rather than collapsing, so the workspace
// keeps its shape while the user clicks around the list.
import { t } from '@/i18n';
import { useUiStore } from '@/stores/ui.store';

withDefaults(
  defineProps<{
    title?: string | null;
    subtitle?: string | null;
    icon?: string | null;
    /** When false the pane shows its empty state instead of the default slot. */
    selected?: boolean;
  }>(),
  { title: null, subtitle: null, icon: null, selected: false },
);

const ui = useUiStore();
</script>

<template>
  <div class="cp-details">
    <header class="cp-details__head">
      <v-icon v-if="icon" :icon="icon" size="15" class="cp-details__icon" />
      <div class="cp-details__titles">
        <div class="cp-details__title">{{ title ?? t('details.title') }}</div>
        <div v-if="subtitle" class="cp-details__sub">{{ subtitle }}</div>
      </div>
      <button
        type="button"
        class="cp-details__close"
        :title="`${t('menu.view.detailsPane')} (F4)`"
        :aria-label="t('common.close')"
        @click="ui.toggleDetails()"
      >
        <v-icon icon="mdi-close" size="14" />
      </button>
    </header>

    <div v-if="selected" class="cp-details__body">
      <slot />
    </div>
    <div v-else class="cp-details__empty">
      <v-icon icon="mdi-gesture-tap" size="20" class="cp-details__empty-icon" />
      <p class="cp-details__empty-text">{{ t('details.empty') }}</p>
    </div>

    <footer v-if="selected && $slots.actions" class="cp-details__foot">
      <slot name="actions" />
    </footer>
  </div>
</template>

<style scoped>
.cp-details {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  background: var(--cp-surface);
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius-md);
  overflow: hidden;
}

.cp-details__head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  height: 28px;
  padding-inline: 8px;
  background: var(--cp-surface-2);
  border-block-end: 1px solid var(--cp-border);
}
.cp-details__icon {
  color: var(--cp-text-muted);
  flex: none;
}
.cp-details__titles {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.cp-details__title {
  font-size: 0.78rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cp-details__sub {
  font-size: 0.72rem;
  color: var(--cp-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cp-details__close {
  flex: none;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  color: var(--cp-text-muted);
  background: transparent;
  border: 0;
  border-radius: var(--cp-radius-sm);
  cursor: default;
}
.cp-details__close:hover {
  background: var(--cp-bg-soft);
  color: var(--cp-text);
}
.cp-details__close:focus-visible {
  outline: 2px solid var(--cp-primary);
  outline-offset: -2px;
}

.cp-details__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.cp-details__empty {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 16px;
  text-align: center;
}
.cp-details__empty-icon {
  color: var(--cp-text-subtle);
}
.cp-details__empty-text {
  margin: 0;
  font-size: 0.76rem;
  color: var(--cp-text-muted);
}

.cp-details__foot {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-block-start: 1px solid var(--cp-border);
  background: var(--cp-surface-2);
}
</style>
