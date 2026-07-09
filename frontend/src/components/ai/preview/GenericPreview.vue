<script setup lang="ts">
// Default, tool-agnostic preview renderer. Any `preview` result whose
// `renderKind` has no dedicated renderer falls back here.
//
// It shows the backend's Arabic summary, its warnings, and — when the tool
// supplies them — the request's steps as Arabic sentences (`payload.lines`).
// Nothing else from `payload` is rendered: a payload is a tool's internal shape,
// and a person must never be shown JSON, ids, or an internal action name.
import { computed } from 'vue';
import { t } from '@/i18n';
import AiPreviewPanel from './AiPreviewPanel.vue';
import type { PlatformPreviewResult } from '@contractor-plus/shared';

const props = defineProps<{ preview: PlatformPreviewResult; busy?: boolean }>();
const emit = defineEmits<{ (e: 'confirm'): void; (e: 'cancel'): void }>();

const lines = computed<string[]>(() => {
  const payload = props.preview.payload as { lines?: unknown } | null;
  const value = payload && typeof payload === 'object' ? payload.lines : undefined;
  return Array.isArray(value) ? value.filter((line): line is string => typeof line === 'string') : [];
});

function onConfirm() {
  emit('confirm');
}
function onCancel() {
  emit('cancel');
}
</script>

<template>
  <AiPreviewPanel
    :title="t('ai.preview.title')"
    icon="mdi-clipboard-text-outline"
    :summary="preview.summary"
    :warnings="preview.warnings"
    :busy="busy"
    @confirm="onConfirm"
    @cancel="onCancel"
  >
    <ul v-if="lines.length" class="ai-preview-lines">
      <li v-for="(line, i) in lines" :key="i">{{ line }}</li>
    </ul>
  </AiPreviewPanel>
</template>

<style scoped>
/* Muted ink clears AA only because the panel is untinted (4.76:1 on surface). */
.ai-preview-lines {
  margin: 0;
  padding-inline-start: 18px;
  font-size: 0.85rem;
  line-height: 1.7;
  color: var(--cp-text-muted);
}
</style>
