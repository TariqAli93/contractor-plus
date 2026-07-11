<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  title: string;
  value?: string | number;
  icon?: string;
  // 'urgent' renders red, 'attention' renders orange, 'positive' green.
  // Default - no accent.
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

</script>

<template>
  <div class="cp-panel cp-panel-hover cp-metric">
    <div class="cp-metric__inner">
      <div class="min-w-0 flex-1">
        <div class="cp-eyebrow truncate">{{ title }}</div>
        <div v-if="loading" class="mt-2">
          <v-skeleton-loader type="heading" />
        </div>
        <div v-else class="cp-metric-value mt-2 truncate">
          <slot>{{ value ?? '-' }}</slot>
        </div>
      </div>
      <span v-if="icon" class="cp-icon-tile" :class="toneClass">
        <v-icon :icon="icon" size="20" />
      </span>
    </div>
  </div>
</template>

<style scoped>
/* Tone is carried by the icon tile alone. A coloured rail down the card edge is
   the side-stripe pattern DESIGN.md bans - the sidebar's active-item rail is
   the one sanctioned exception, and this is not it. */
.cp-metric {
  padding: 7px 8px;
}
.cp-metric__inner {
  display: flex;
  align-items: flex-start;
  gap: 7px;
}
</style>
