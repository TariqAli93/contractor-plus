<script setup lang="ts">
import { t } from '@/i18n';

defineProps<{
  title?: string;
  description?: string;
  icon?: string;
  // compact reduces vertical padding for use inside dashboard widgets.
  compact?: boolean;
}>();

</script>

<template>
  <div
    class="cp-empty"
    :class="{ 'cp-empty--compact': compact }"
  >
    <div class="cp-empty__halo">
      <v-icon :icon="icon ?? 'mdi-inbox-outline'" :size="compact ? 28 : 40" />
    </div>
    <div class="cp-empty__title">{{ title ?? t('common.empty') }}</div>
    <div v-if="description" class="cp-empty__desc">
      {{ description }}
    </div>
    <slot />
  </div>
</template>

<style scoped>
.cp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 10px;
  padding: 48px 24px;
}
.cp-empty--compact {
  padding: 28px 20px;
  gap: 8px;
}
.cp-empty__halo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: var(--cp-radius-pill);
  background: var(--cp-bg-soft);
  color: var(--cp-text-muted);
  margin-bottom: 4px;
}
.cp-empty--compact .cp-empty__halo {
  width: 48px;
  height: 48px;
  margin-bottom: 0;
}
.cp-empty__title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--cp-text);
}
.cp-empty--compact .cp-empty__title {
  font-size: 0.9rem;
}
.cp-empty__desc {
  font-size: 0.85rem;
  color: var(--cp-text-muted);
  max-width: 28rem;
  line-height: 1.5;
}
</style>
