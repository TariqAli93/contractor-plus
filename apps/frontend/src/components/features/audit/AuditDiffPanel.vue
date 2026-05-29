<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  oldValues: unknown;
  newValues: unknown;
}>();

const { t } = useI18n();

function pretty(v: unknown): string {
  if (v === null || v === undefined) return '—';
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
        class="text-caption bg-grey-lighten-4 dark:bg-grey-darken-4 rounded pa-3 overflow-auto max-h-80 whitespace-pre-wrap break-words mb-0"
        :class="{ 'text-medium-emphasis italic': !hasOld }"
      >{{ pretty(oldValues) }}</pre>
    </div>
    <div>
      <div class="text-caption text-medium-emphasis mb-1">
        {{ t('audit.fields.newValues') }}
      </div>
      <pre
        class="text-caption bg-grey-lighten-4 dark:bg-grey-darken-4 rounded pa-3 overflow-auto max-h-80 whitespace-pre-wrap break-words mb-0"
        :class="{ 'text-medium-emphasis italic': !hasNew }"
      >{{ pretty(newValues) }}</pre>
    </div>
  </div>
</template>
