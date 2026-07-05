<script setup lang="ts">
// Compact, reusable page header — the backbone of the desktop sweep. Every
// screen gets the same dense title row: a small title, an optional record
// count, and an inline-end cluster of quick-actions (the default slot). This
// replaces the ad-hoc `text-h5 + mb-4 + big v-btn` headers with one tight,
// consistent bar so the whole app reads as a single tool.
withDefaults(
  defineProps<{
    title: string;
    /** Optional record count shown as a pill next to the title. */
    count?: number | string | null;
    /** Optional muted subtitle / context line under the title. */
    subtitle?: string | null;
    /** Optional leading icon (mdi-*). */
    icon?: string | null;
    /** Optional back-navigation target — renders a back button before the
     *  title (replaces the old ad-hoc back-arrow + heading rows). */
    back?: string | null;
    /** Optional plain-language "what to do here" line rendered muted under the
     *  header — the simplification layer for non-technical users. */
    hint?: string | null;
  }>(),
  { count: null, subtitle: null, icon: null, back: null, hint: null },
);
</script>

<template>
  <div class="cp-page-header-wrap">
    <div class="cp-page-header">
      <div class="cp-page-header-lead">
      <v-btn
        v-if="back"
        icon="mdi-arrow-right"
        variant="text"
        size="small"
        density="comfortable"
        class="cp-page-header-back"
        :to="back"
      />
      <v-icon v-if="icon" size="18" class="cp-page-header-icon">{{ icon }}</v-icon>
      <h1 class="cp-page-header-title">{{ title }}</h1>
      <span v-if="count != null" class="cp-page-header-count">{{ count }}</span>
      <span v-if="subtitle" class="cp-page-header-sub">{{ subtitle }}</span>
    </div>
    <div class="cp-page-header-actions">
        <slot />
      </div>
    </div>
    <p v-if="hint" class="cp-page-hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
.cp-page-header-wrap {
  margin-bottom: 8px;
}
.cp-page-header {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 32px;
  flex-wrap: wrap;
}
.cp-page-hint {
  margin: 3px 0 0;
  font-size: 0.78rem;
  line-height: 1.45;
  color: var(--cp-text-muted);
  max-width: 68ch;
}
.cp-page-header-lead {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.cp-page-header-back {
  margin-inline-start: -6px;
  color: var(--cp-text-muted);
}
.cp-page-header-icon {
  color: var(--cp-text-muted);
}
.cp-page-header-title {
  font-size: 0.98rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--cp-text);
  margin: 0;
  white-space: nowrap;
}
.cp-page-header-count {
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
  color: var(--cp-text-muted);
  background: var(--cp-surface);
  border: 1px solid var(--cp-border);
  border-radius: 999px;
  padding: 1px 8px;
}
.cp-page-header-sub {
  font-size: 0.78rem;
  color: var(--cp-text-muted);
  white-space: nowrap;
}
.cp-page-header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-inline-start: auto;
}
</style>
