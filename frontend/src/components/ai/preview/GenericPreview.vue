<script setup lang="ts">
// Default, tool-agnostic preview renderer. Any `preview` result whose
// `renderKind` has no dedicated renderer falls back here: it shows the summary,
// any warnings, and a best-effort key/value view of the tool payload. All
// values are backend-supplied strings — no computation happens here.
import { computed } from 'vue';
import { t } from '@/i18n';
import type { PlatformPreviewResult } from '@contractor-plus/shared';

const props = defineProps<{ preview: PlatformPreviewResult; busy?: boolean }>();
const emit = defineEmits<{ (e: 'confirm'): void; (e: 'cancel'): void }>();

interface KvRow {
  key: string;
  value: string;
}

function stringify(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

// Flatten a plain object payload into display rows; non-object payloads render
// as a single JSON blob instead.
const rows = computed<KvRow[]>(() => {
  const p = props.preview.payload;
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    return Object.entries(p as Record<string, unknown>).map(([key, value]) => ({
      key,
      value: stringify(value),
    }));
  }
  return [];
});

const rawJson = computed<string | null>(() =>
  rows.value.length ? null : stringify(props.preview.payload),
);

function onConfirm() {
  emit('confirm');
}
function onCancel() {
  emit('cancel');
}
</script>

<template>
  <v-card variant="tonal" class="ai-preview">
    <div class="ai-preview__head">
      <v-icon size="18" class="me-1">mdi-clipboard-text-outline</v-icon>
      <span class="font-medium">{{ preview.toolName || t('ai.preview.title') }}</span>
    </div>

    <p v-if="preview.summary" class="ai-preview__summary">{{ preview.summary }}</p>

    <v-alert
      v-for="(w, i) in preview.warnings"
      :key="i"
      type="warning"
      variant="tonal"
      density="compact"
      class="mb-2"
    >
      {{ w }}
    </v-alert>

    <v-table v-if="rows.length" density="compact" class="ai-preview__table">
      <tbody>
        <tr v-for="row in rows" :key="row.key">
          <th class="ai-preview__k">{{ row.key }}</th>
          <td class="ai-preview__v">{{ row.value }}</td>
        </tr>
      </tbody>
    </v-table>

    <pre v-else-if="rawJson" class="ai-preview__json">{{ rawJson }}</pre>

    <div class="ai-preview__actions">
      <v-btn
        color="primary"
        variant="flat"
        size="small"
        prepend-icon="mdi-check"
        :loading="busy"
        :disabled="busy"
        @click="onConfirm"
      >
        {{ t('ai.confirm') }}
      </v-btn>
      <v-btn variant="text" size="small" :disabled="busy" @click="onCancel">
        {{ t('ai.cancel') }}
      </v-btn>
    </div>
  </v-card>
</template>

<style scoped>
.ai-preview {
  padding: 12px;
}
.ai-preview__head {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
}
.ai-preview__summary {
  font-size: 0.9rem;
  line-height: 1.6;
  margin-bottom: 10px;
}
.ai-preview__table {
  margin-bottom: 10px;
  background: transparent;
}
.ai-preview__k {
  font-weight: 600;
  white-space: nowrap;
  color: var(--cp-text-muted, #888);
  text-align: start;
}
.ai-preview__v {
  word-break: break-word;
}
.ai-preview__json {
  font-size: 0.78rem;
  background: rgba(var(--v-theme-on-surface), 0.05);
  border-radius: 6px;
  padding: 8px;
  overflow-x: auto;
  margin-bottom: 10px;
  white-space: pre-wrap;
  word-break: break-word;
}
.ai-preview__actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
</style>
