<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { t, te } from '@/i18n';
import { aiApi } from '@/services/api/ai.api';
import { useApiError } from '@/composables/useApiError';
import type { AiSettings } from '@/types/ai';
import SettingsCard from './SettingsCard.vue';
import ErrorState from '@/components/shared/ErrorState.vue';

// Phase 6 — AI governance view (gated by ai.manage-settings). Config-sourced
// values (models, sources, budget) are shown READ-ONLY: they live in
// service.json (prod) / .env (dev), the single-source-of-truth contract.
const { handle } = useApiError();

const data = ref<AiSettings | null>(null);
const loading = ref(false);
const error = ref<unknown>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    data.value = await aiApi.settings();
  } catch (e) {
    error.value = e;
    handle(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const usage = computed(() => data.value?.usage ?? null);

const budgetPercent = computed(() => {
  const u = usage.value;
  if (!u || u.budget === null || u.budget === 0) return null;
  return Math.min(100, Math.round((u.totalTokens / u.budget) * 100));
});

const budgetColor = computed(() => {
  const p = budgetPercent.value;
  if (p === null) return 'primary';
  if (p >= 100) return 'error';
  if (p >= 80) return 'warning';
  return 'success';
});

function opLabel(op: string): string {
  const key = `settings.ai.operations.${op}`;
  return te(key) ? t(key) : op;
}

const fmtNum = (n: number): string => new Intl.NumberFormat('en-US').format(n);
</script>

<template>
  <div class="cp-ai-settings">
    <ErrorState v-if="error" :error="error" class="ma-2" @retry="load" />

    <template v-else>
      <!-- Status -->
      <SettingsCard :title="t('settings.ai.statusTitle')" icon="mdi-robot-outline">
        <div v-if="loading && !data" class="cp-ai-settings__loading">
          <v-skeleton-loader type="list-item-two-line" />
        </div>
        <div v-else-if="data" class="cp-ai-settings__status">
          <v-chip
            :color="data.enabled ? 'success' : 'default'"
            size="small"
            variant="tonal"
            label
          >
            <v-icon :icon="data.enabled ? 'mdi-check-circle' : 'mdi-cancel'" start size="14" />
            {{ data.enabled ? t('settings.ai.enabled') : t('settings.ai.disabled') }}
          </v-chip>
          <span v-if="!data.enabled && data.reason" class="cp-ai-settings__reason">
            {{ te(`settings.ai.reasons.${data.reason}`) ? t(`settings.ai.reasons.${data.reason}`) : data.reason }}
          </span>
        </div>
      </SettingsCard>

      <!-- Monthly consumption -->
      <SettingsCard
        v-if="usage"
        :title="t('settings.ai.usageTitle')"
        :description="t('settings.ai.usageDesc')"
        icon="mdi-chart-donut"
      >
        <div class="cp-ai-settings__usage">
          <div class="cp-ai-settings__metrics">
            <div class="cp-ai-settings__metric">
              <span class="cp-ai-settings__metric-val">{{ fmtNum(usage.totalTokens) }}</span>
              <span class="cp-ai-settings__metric-lbl">{{ t('settings.ai.totalTokens') }}</span>
            </div>
            <div class="cp-ai-settings__metric">
              <span class="cp-ai-settings__metric-val">{{ fmtNum(usage.requestCount) }}</span>
              <span class="cp-ai-settings__metric-lbl">{{ t('settings.ai.requests') }}</span>
            </div>
            <div class="cp-ai-settings__metric">
              <span class="cp-ai-settings__metric-val">
                {{ usage.budget === null ? t('settings.ai.unlimited') : fmtNum(usage.budget) }}
              </span>
              <span class="cp-ai-settings__metric-lbl">{{ t('settings.ai.budget') }}</span>
            </div>
          </div>

          <div v-if="budgetPercent !== null" class="cp-ai-settings__bar">
            <v-progress-linear
              :model-value="budgetPercent"
              :color="budgetColor"
              height="8"
              rounded
            />
            <div class="cp-ai-settings__bar-meta">
              <span>{{ budgetPercent }}%</span>
              <span v-if="usage.overBudget" class="cp-ai-settings__over">
                {{ t('settings.ai.overBudget') }}
              </span>
              <span v-else>{{ t('settings.ai.remaining', { n: fmtNum(usage.remaining ?? 0) }) }}</span>
            </div>
          </div>

          <table v-if="usage.byOperation.length" class="cp-ai-settings__ops">
            <thead>
              <tr>
                <th>{{ t('settings.ai.operation') }}</th>
                <th class="text-end">{{ t('settings.ai.requests') }}</th>
                <th class="text-end">{{ t('settings.ai.tokens') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="op in usage.byOperation" :key="op.operationType">
                <td>{{ opLabel(op.operationType) }}</td>
                <td class="text-end">{{ fmtNum(op.count) }}</td>
                <td class="text-end">{{ fmtNum(op.tokens) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="cp-ai-settings__muted">{{ t('settings.ai.noUsage') }}</p>
        </div>
      </SettingsCard>

      <!-- Configuration (read-only reflection) -->
      <SettingsCard
        v-if="data"
        :title="t('settings.ai.configTitle')"
        :description="t('settings.ai.configDesc')"
        icon="mdi-cog-outline"
      >
        <dl class="cp-ai-settings__config">
          <dt>{{ t('settings.ai.modelDefault') }}</dt>
          <dd>{{ data.modelDefault ?? '—' }}</dd>
          <dt>{{ t('settings.ai.modelHeavy') }}</dt>
          <dd>{{ data.modelHeavy ?? '—' }}</dd>
          <dt>{{ t('settings.ai.priceSources') }}</dt>
          <dd>
            <template v-if="data.sources.length">
              <span v-for="(s, i) in data.sources" :key="i" class="cp-ai-settings__src">
                {{ s.name }}<template v-if="s.region"> ({{ s.region }})</template>
              </span>
            </template>
            <span v-else>{{ t('settings.ai.noSources') }}</span>
          </dd>
          <dt>{{ t('settings.ai.syncInterval') }}</dt>
          <dd>
            {{
              data.syncIntervalHours
                ? t('settings.ai.everyHours', { n: data.syncIntervalHours })
                : t('settings.ai.manualOnly')
            }}
          </dd>
        </dl>
        <p class="cp-ai-settings__note">{{ t('settings.ai.configNote') }}</p>
      </SettingsCard>
    </template>
  </div>
</template>

<style scoped>
.cp-ai-settings {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cp-ai-settings__status {
  display: flex;
  align-items: center;
  gap: 10px;
}
.cp-ai-settings__reason {
  font-size: 0.78rem;
  color: var(--cp-text-muted);
}
.cp-ai-settings__metrics {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
}
.cp-ai-settings__metric {
  display: flex;
  flex-direction: column;
}
.cp-ai-settings__metric-val {
  font-size: 1.1rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.cp-ai-settings__metric-lbl {
  font-size: 0.72rem;
  color: var(--cp-text-muted);
}
.cp-ai-settings__bar {
  margin-block: 10px 4px;
}
.cp-ai-settings__bar-meta {
  display: flex;
  justify-content: space-between;
  margin-top: 3px;
  font-size: 0.72rem;
  color: var(--cp-text-muted);
}
.cp-ai-settings__over {
  color: rgb(var(--v-theme-error));
  font-weight: 600;
}
.cp-ai-settings__ops {
  width: 100%;
  margin-top: 10px;
  border-collapse: collapse;
  font-size: 0.78rem;
}
.cp-ai-settings__ops th {
  text-align: start;
  font-weight: 500;
  color: var(--cp-text-muted);
  padding: 4px 6px;
  border-block-end: 1px solid var(--cp-border);
}
.cp-ai-settings__ops td {
  padding: 4px 6px;
  border-block-end: 1px solid var(--cp-border);
  font-variant-numeric: tabular-nums;
}
.cp-ai-settings__config {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 5px 14px;
  font-size: 0.8rem;
}
.cp-ai-settings__config dt {
  color: var(--cp-text-muted);
}
.cp-ai-settings__config dd {
  margin: 0;
  direction: ltr;
  text-align: start;
}
.cp-ai-settings__src:not(:last-child)::after {
  content: '، ';
}
.cp-ai-settings__note,
.cp-ai-settings__muted {
  margin: 8px 0 0;
  font-size: 0.72rem;
  color: var(--cp-text-muted);
}
</style>
