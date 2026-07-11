<script setup lang="ts">
import { computed } from 'vue';
import { t } from '@/i18n';

const props = defineProps<{
  oldValues: unknown;
  newValues: unknown;
}>();

function pretty(v: unknown): string {
  if (v === null || v === undefined) return '-';
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

const hasOld = computed(() => props.oldValues !== null && props.oldValues !== undefined);
const hasNew = computed(() => props.newValues !== null && props.newValues !== undefined);
</script>

<template>
  <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
    <div>
      <div class="text-caption text-medium-emphasis mb-1">
        {{ t('audit.fields.oldValues') }}
      </div>
      <pre
        class="cp-audit-json text-caption pa-3 overflow-auto max-h-80 whitespace-pre-wrap break-words mb-0"
        :class="{ 'text-medium-emphasis italic': !hasOld }"
      >{{ pretty(oldValues) }}</pre>
    </div>
    <div>
      <div class="text-caption text-medium-emphasis mb-1">
        {{ t('audit.fields.newValues') }}
      </div>
      <pre
        class="cp-audit-json text-caption pa-3 overflow-auto max-h-80 whitespace-pre-wrap break-words mb-0"
        :class="{ 'text-medium-emphasis italic': !hasNew }"
      >{{ pretty(newValues) }}</pre>
    </div>
  </div>
</template>

<style scoped>
.cp-audit-json {
  margin: 0;
  color: var(--cp-text);
  background: var(--cp-panel);
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius-sm);
}
</style>
