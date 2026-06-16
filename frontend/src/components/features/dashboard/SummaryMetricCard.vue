<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  title: string;
  value?: string | number;
  icon?: string;
  // 'urgent' renders red, 'attention' renders orange, 'positive' green.
  // Default — no accent.
  tone?: 'urgent' | 'attention' | 'positive' | 'neutral';
  loading?: boolean;
}>();

const toneClass = computed(() => {
  switch (props.tone) {
    case 'urgent':
      return 'cp-icon-tile--error';
    case 'attention':
      return 'cp-icon-tile--warning';
    case 'positive':
      return 'cp-icon-tile--success';
    default:
      return 'cp-icon-tile--neutral';
  }
});

const accentVar = computed(() => {
  switch (props.tone) {
    case 'urgent':
      return 'var(--cp-error)';
    case 'attention':
      return 'var(--cp-warning)';
    case 'positive':
      return 'var(--cp-success)';
    default:
      return 'transparent';
  }
});
</script>

<template>
  <div
    class="cp-panel cp-panel-hover cp-metric"
    :style="{ '--cp-metric-accent': accentVar }"
  >
    <div class="cp-metric__inner">
      <div class="min-w-0 flex-1">
        <div class="cp-eyebrow truncate">{{ title }}</div>
        <div v-if="loading" class="mt-2">
          <v-skeleton-loader type="heading" />
        </div>
        <div v-else class="cp-metric-value mt-2 truncate">
          <slot>{{ value ?? '—' }}</slot>
        </div>
      </div>
      <span v-if="icon" class="cp-icon-tile" :class="toneClass">
        <v-icon :icon="icon" size="20" />
      </span>
    </div>
  </div>
</template>

<style scoped>
.cp-metric {
  position: relative;
  overflow: hidden;
  padding: 16px 18px;
}
.cp-metric::before {
  content: '';
  position: absolute;
  inset-inline-start: 0;
  top: 14px;
  bottom: 14px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--cp-metric-accent);
  opacity: 0.9;
  transition: opacity var(--cp-dur-base) var(--cp-ease);
}
.cp-metric__inner {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
</style>
