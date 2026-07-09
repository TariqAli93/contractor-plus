<script setup lang="ts">
import { t } from '@/i18n';
import { ApiError } from '@/types/api';

const props = defineProps<{ error?: unknown }>();
defineEmits<{ (e: 'retry'): void }>();

function describe(err: unknown): { message: string; reqId?: string } {
  if (err instanceof ApiError) return { message: err.message, reqId: err.reqId };
  if (err instanceof Error) return { message: err.message };
  return { message: t('common.error') };
}
</script>

<template>
  <div class="cp-error">
    <div class="cp-error__halo">
      <v-icon icon="mdi-alert-circle-outline" size="32" />
    </div>
    <div class="cp-error__title">{{ describe(props.error).message }}</div>
    <div v-if="describe(props.error).reqId" class="cp-error__meta">
      reqId: {{ describe(props.error).reqId }}
    </div>
    <v-btn
      variant="tonal"
      color="primary"
      prepend-icon="mdi-refresh"
      class="mt-2"
      @click="$emit('retry')"
    >
      {{ t('common.retry') }}
    </v-btn>
  </div>
</template>

<style scoped>
.cp-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 8px;
  padding: 48px 24px;
  background: var(--cp-surface);
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius-lg);
}
.cp-error__halo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: var(--cp-radius-pill);
  background: var(--cp-error-soft);
  color: var(--cp-error);
  margin-bottom: 6px;
}
.cp-error__title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--cp-text);
  max-width: 32rem;
}
.cp-error__meta {
  font-size: 0.78rem;
  color: var(--cp-text-muted);
}
</style>
