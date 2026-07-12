<script setup lang="ts">
import { computed } from 'vue';
import { t, te } from '@/i18n';
import { useAccess } from '@/composables/useAccess';
import { useAiReports } from '@/composables/useAiReports';
import type { AiReportType } from '@/types/ai';

// Optional AI interpretation strip under a numeric report. Loads ONLY on
// demand (a model call costs money), fails quietly inside its own bounds,
// and disappears entirely for users without ai.generate-reports.
const props = defineProps<{
  reportType: AiReportType;
  /** The SAME filters the numeric report is currently showing. */
  filters?: Record<string, unknown>;
}>();

const { hasPermission } = useAccess();
const allowed = computed(() => hasPermission('ai.generate-reports'));

const { narrative, loading, error, statusKnown, aiEnabled, generate } = useAiReports(
  props.reportType,
);

function run() {
  void generate(props.filters ?? {});
}

const errorMessage = computed(() => {
  if (!error.value) return '';
  const key = `reports.aiNarrative.errors.${error.value.code}`;
  return te(key) ? t(key) : t('reports.aiNarrative.errors.generic');
});
</script>

<template>
  <section v-if="allowed" class="cp-pane cp-ai-narrative">
    <div class="cp-pane__toolbar">
      <span class="cp-ai-narrative__title">
        <v-icon icon="mdi-auto-fix" size="15" />
        {{ t('reports.aiNarrative.title') }}
      </span>
      <span v-if="narrative" class="cp-ai-narrative__model">
        {{ t('reports.aiNarrative.model') }}: {{ narrative.modelUsed }}
      </span>
      <v-btn
        v-if="aiEnabled"
        size="small"
        variant="text"
        prepend-icon="mdi-refresh"
        :loading="loading"
        @click="run"
      >
        {{ narrative ? t('reports.aiNarrative.regenerate') : t('reports.aiNarrative.generate') }}
      </v-btn>
    </div>

    <div class="cp-ai-narrative__body">
      <!-- Disabled (no key on the server) — quiet, informative, nothing broken. -->
      <p v-if="statusKnown && !aiEnabled" class="cp-ai-narrative__muted">
        <v-icon icon="mdi-information-outline" size="14" />
        {{ t('reports.aiNarrative.disabled') }}
      </p>

      <template v-else>
        <v-progress-linear v-if="loading" indeterminate height="2" class="mb-2" />
        <p v-if="loading" class="cp-ai-narrative__muted">
          {{ t('reports.aiNarrative.generating') }}
        </p>

        <p v-else-if="error" class="cp-ai-narrative__error">
          <v-icon icon="mdi-alert-circle-outline" size="14" />
          {{ errorMessage }}
        </p>

        <template v-else-if="narrative">
          <p class="cp-ai-narrative__text">{{ narrative.narrative }}</p>
          <div v-if="narrative.factors.length" class="cp-ai-narrative__factors">
            <span class="cp-ai-narrative__factors-title">{{ t('reports.aiNarrative.factors') }}:</span>
            <ul>
              <li v-for="(factor, i) in narrative.factors" :key="i">{{ factor }}</li>
            </ul>
          </div>
          <p class="cp-ai-narrative__muted cp-ai-narrative__disclaimer">
            {{ t('reports.aiNarrative.disclaimer') }}
          </p>
        </template>

        <p v-else class="cp-ai-narrative__muted">{{ t('reports.aiNarrative.idleHint') }}</p>
      </template>
    </div>
  </section>
</template>

<style scoped>
.cp-ai-narrative {
  margin-block-start: 8px;
  flex: 0 0 auto;
}
.cp-ai-narrative__title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  font-weight: 500;
}
.cp-ai-narrative__model {
  margin-inline-start: auto;
  color: var(--cp-text-muted);
  font-size: 0.72rem;
  direction: ltr;
}
.cp-ai-narrative__model + .v-btn {
  margin-inline-start: 8px;
}
.cp-ai-narrative__title + .v-btn {
  margin-inline-start: auto;
}
.cp-ai-narrative__body {
  padding: 8px 12px;
  font-size: 0.8rem;
}
.cp-ai-narrative__text {
  margin: 0;
  line-height: 1.7;
  white-space: pre-line;
}
.cp-ai-narrative__factors {
  margin-block-start: 6px;
}
.cp-ai-narrative__factors ul {
  margin: 2px 0 0;
  padding-inline-start: 18px;
}
.cp-ai-narrative__factors li {
  line-height: 1.6;
}
.cp-ai-narrative__factors-title {
  font-weight: 500;
}
.cp-ai-narrative__muted {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: var(--cp-text-muted);
}
.cp-ai-narrative__disclaimer {
  display: block;
  margin-block-start: 8px;
  padding-block-start: 6px;
  border-block-start: 1px solid var(--cp-border);
  font-size: 0.72rem;
}
.cp-ai-narrative__error {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: rgb(var(--v-theme-error));
}
</style>
