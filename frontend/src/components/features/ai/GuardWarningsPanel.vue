<script setup lang="ts">
import { t } from '@/i18n';
import type { GuardWarning } from '@/types/ai';

// Inline advisory strip inside the cost/payment forms. Informational by
// design: it never disables the save button — the caller relabels it and
// lets the second click through.
defineProps<{ warnings: GuardWarning[] }>();
</script>

<template>
  <div v-if="warnings.length" class="cp-guard">
    <div class="cp-guard__title">
      <v-icon icon="mdi-shield-alert-outline" size="15" />
      {{ t('aiGuard.title') }}
    </div>
    <ul class="cp-guard__list">
      <li v-for="w in warnings" :key="w.code" :class="`cp-guard__item is-${w.severity}`">
        {{ w.message }}
        <span v-if="w.source === 'ai'" class="cp-guard__ai-tag">{{ t('aiGuard.aiTag') }}</span>
      </li>
    </ul>
    <p class="cp-guard__note">{{ t('aiGuard.note') }}</p>
  </div>
</template>

<style scoped>
.cp-guard {
  margin: 0 16px 4px;
  padding: 8px 12px;
  font-size: 0.78rem;
  background: var(--cp-surface-2);
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius-sm);
}
.cp-guard__title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
  margin-bottom: 4px;
  color: rgb(var(--v-theme-warning));
}
.cp-guard__list {
  margin: 0;
  padding-inline-start: 18px;
}
.cp-guard__item {
  line-height: 1.7;
}
.cp-guard__item.is-info {
  color: var(--cp-text-muted);
}
.cp-guard__ai-tag {
  margin-inline-start: 4px;
  padding: 0 5px;
  font-size: 0.66rem;
  color: var(--cp-text-muted);
  border: 1px solid var(--cp-border);
  border-radius: 999px;
}
.cp-guard__note {
  margin: 6px 0 0;
  font-size: 0.7rem;
  color: var(--cp-text-muted);
}
</style>
