<script setup lang="ts">
defineProps<{
  title: string;
  description?: string;
  icon?: string;
}>();
</script>

<template>
  <section class="cp-panel cp-settings-card">
    <header class="cp-settings-card__head">
      <div class="flex items-start gap-3 min-w-0">
        <span v-if="icon" class="cp-icon-tile">
          <v-icon :icon="icon" size="20" />
        </span>
        <div class="min-w-0">
          <h2 class="cp-settings-card__title">{{ title }}</h2>
          <p v-if="description" class="cp-settings-card__desc">{{ description }}</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <slot name="action" />
      </div>
    </header>
    <div class="cp-settings-card__body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.cp-settings-card {
  padding: 0;
  display: flex;
  flex-direction: column;
}
.cp-settings-card__head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 8px;
  border-bottom: 1px solid var(--cp-border);
  flex-wrap: wrap;
}
.cp-settings-card__title {
  font-size: 0.86rem;
  font-weight: 600;
  color: var(--cp-text);
  letter-spacing: -0.005em;
}
.cp-settings-card__desc {
  font-size: 0.76rem;
  color: var(--cp-text-muted);
  margin-top: 2px;
  max-width: 60ch;
}
.cp-settings-card__body {
  padding: 8px;
}
</style>
