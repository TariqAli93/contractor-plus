<script setup lang="ts">
defineProps<{
  title: string;
  icon?: string;
}>();
</script>

<template>
  <section class="cp-panel cp-section">
    <header class="cp-section__head">
      <div class="flex items-center gap-2 min-w-0">
        <v-icon v-if="icon" :icon="icon" size="20" class="cp-section__icon" />
        <h2 class="cp-section-title truncate">{{ title }}</h2>
      </div>
      <div class="flex items-center gap-1">
        <slot name="action" />
      </div>
    </header>
    <div class="cp-section__body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.cp-section__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--cp-border);
}
.cp-section__icon {
  color: var(--cp-text-muted);
}
.cp-section__body {
  min-height: 0;
}
</style>
