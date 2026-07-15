<script setup lang="ts">
// A compact confirmation that a tool ran (a read result or a completed write).
import type { ToolResult } from '@/types/aiActions';

defineProps<{ result: ToolResult }>();
</script>

<template>
  <div class="cp-tool-result">
    <v-icon size="16" color="success" class="cp-tool-result__icon">mdi-check-circle-outline</v-icon>
    <span class="cp-tool-result__summary">{{ result.summary }}</span>
  </div>
</template>

<style scoped>
.cp-tool-result {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius-sm);
  background: var(--cp-surface-2);
  font-size: 0.82rem;
}
.cp-tool-result__icon {
  flex: none;
}
.cp-tool-result__summary {
  color: var(--cp-text);
  overflow-wrap: anywhere;
}
</style>
