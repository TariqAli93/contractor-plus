<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { t, te } from '@/i18n';
import { useAiSettings } from '@/composables/useAiSettings';
import { useToast } from '@/composables/useToast';
import { useConfirm } from '@/composables/useConfirm';
import { ApiError } from '@/types/api';
import { AI_FEATURE_KEYS, type AiFeatureKey } from '@/types/ai';
import SettingsCard from './SettingsCard.vue';
import ErrorState from '@/components/shared/ErrorState.vue';

// Phase 2.5 — the AI control panel. Toggles/models/budget are DB-backed (DB
// wins over env); the API key is managed here ENCRYPTED (or shown as
// "managed by the server" when it comes from env). The raw key is never
// displayed and never kept in state after it is sent.
const { data, loading, saving, error, load, update, setKey, clearKey } = useAiSettings();
const toast = useToast();
const { confirm } = useConfirm();

onMounted(load);

// ----- editable general controls (local draft + Save) -----
const draft = reactive({
  systemEnabled: true,
  features: {} as Record<AiFeatureKey, boolean>,
  modelDefault: null as string | null,
  modelHeavy: null as string | null,
  monthlyTokenBudget: null as number | null,
});

watch(
  data,
  (d) => {
    if (!d) return;
    draft.systemEnabled = d.systemEnabled;
    draft.features = { ...d.features };
    draft.modelDefault = d.modelDefault ?? null;
    draft.modelHeavy = d.modelHeavy ?? null;
    draft.monthlyTokenBudget = d.monthlyTokenBudget;
  },
  { immediate: true },
);

const dirty = computed(() => {
  const d = data.value;
  if (!d) return false;
  return (
    draft.systemEnabled !== d.systemEnabled ||
    AI_FEATURE_KEYS.some((f) => draft.features[f] !== d.features[f]) ||
    (draft.modelDefault ?? null) !== (d.modelDefault ?? null) ||
    (draft.modelHeavy ?? null) !== (d.modelHeavy ?? null) ||
    (draft.monthlyTokenBudget ?? null) !== (d.monthlyTokenBudget ?? null)
  );
});

const modelOptions = computed(() => data.value?.modelAllowlist ?? []);

async function saveGeneral() {
  try {
    await update({
      systemEnabled: draft.systemEnabled,
      features: { ...draft.features },
      modelDefault: draft.modelDefault,
      modelHeavy: draft.modelHeavy,
      monthlyTokenBudget: draft.monthlyTokenBudget,
    });
    toast.success(t('common.saved'));
  } catch (e) {
    toast.error(errMsg(e));
  }
}

function resetGeneral() {
  if (data.value) watchTrigger();
}
function watchTrigger() {
  const d = data.value!;
  draft.systemEnabled = d.systemEnabled;
  draft.features = { ...d.features };
  draft.modelDefault = d.modelDefault ?? null;
  draft.modelHeavy = d.modelHeavy ?? null;
  draft.monthlyTokenBudget = d.monthlyTokenBudget;
}

// ----- API key management -----
const keyInput = ref('');
const showKeyField = ref(false);

const envManaged = computed(() => data.value?.key.managedByEnv ?? false);
const keyMgmtOff = computed(() => data.value?.keyManagementEnabled === false);

async function saveKey() {
  const value = keyInput.value.trim();
  if (!value) return;
  try {
    await setKey(value);
    keyInput.value = ''; // never retain the raw key
    showKeyField.value = false;
    toast.success(t('settings.ai.key.saved'));
  } catch (e) {
    toast.error(errMsg(e));
  }
}

async function removeKey() {
  const ok = await confirm({
    title: t('settings.ai.key.removeTitle'),
    message: t('settings.ai.key.removeText'),
    confirmText: t('settings.ai.key.remove'),
    cancelText: t('common.cancel'),
    destructive: true,
  });
  if (!ok) return;
  try {
    await clearKey();
    toast.info(t('settings.ai.key.removed'));
  } catch (e) {
    toast.error(errMsg(e));
  }
}

// ----- usage (read-only, from Phase 6) -----
const usage = computed(() => data.value?.usage ?? null);
const budgetPercent = computed(() => {
  const u = usage.value;
  if (!u || u.budget === null || u.budget === 0) return null;
  return Math.min(100, Math.round((u.totalTokens / u.budget) * 100));
});

function opLabel(op: string): string {
  const key = `settings.ai.operations.${op}`;
  return te(key) ? t(key) : op;
}
const fmtNum = (n: number): string => new Intl.NumberFormat('en-US').format(n);

function errMsg(e: unknown): string {
  if (e instanceof ApiError) {
    const key = `settings.ai.errors.${e.code}`;
    return te(key) ? t(key) : e.message;
  }
  return t('settings.ai.errors.generic');
}
</script>

<template>
  <div class="cp-ai-settings">
    <ErrorState v-if="error" :error="error" class="ma-2" @retry="load" />

    <template v-else-if="data">
      <!-- Status -->
      <SettingsCard :title="t('settings.ai.statusTitle')" icon="mdi-robot-outline">
        <div class="cp-ai-settings__status">
          <v-chip :color="data.enabled ? 'success' : 'default'" size="small" variant="tonal" label>
            <v-icon :icon="data.enabled ? 'mdi-check-circle' : 'mdi-cancel'" start size="14" />
            {{ data.enabled ? t('settings.ai.enabled') : t('settings.ai.disabled') }}
          </v-chip>
          <span v-if="!data.enabled && data.reason" class="cp-ai-settings__reason">
            {{ te(`settings.ai.reasons.${data.reason}`) ? t(`settings.ai.reasons.${data.reason}`) : data.reason }}
          </span>
        </div>
      </SettingsCard>

      <!-- General controls (DB-backed; Save persists) -->
      <SettingsCard
        :title="t('settings.ai.controlsTitle')"
        :description="t('settings.ai.controlsDesc')"
        icon="mdi-tune-variant"
      >
        <template #action>
          <template v-if="dirty">
            <v-btn size="small" variant="text" :disabled="saving" @click="resetGeneral">
              {{ t('common.cancel') }}
            </v-btn>
            <v-btn size="small" color="primary" variant="flat" :loading="saving" @click="saveGeneral">
              {{ t('common.saveChanges') }}
            </v-btn>
          </template>
        </template>

        <v-switch
          v-model="draft.systemEnabled"
          :label="t('settings.ai.systemEnabled')"
          color="primary"
          density="compact"
          hide-details
          inset
        />
        <v-divider class="my-2" />
        <div class="cp-ai-settings__label">{{ t('settings.ai.featuresTitle') }}</div>
        <div class="cp-ai-settings__features">
          <v-switch
            v-for="f in AI_FEATURE_KEYS"
            :key="f"
            v-model="draft.features[f]"
            :label="t(`settings.ai.features.${f}`)"
            :disabled="!draft.systemEnabled"
            color="primary"
            density="compact"
            hide-details
            inset
          />
        </div>
        <v-divider class="my-2" />
        <div class="cp-ai-settings__grid">
          <v-select
            v-model="draft.modelDefault"
            :items="modelOptions"
            :label="t('settings.ai.modelDefault')"
            density="compact"
            clearable
            :placeholder="t('settings.ai.envDefault')"
            persistent-placeholder
          />
          <v-select
            v-model="draft.modelHeavy"
            :items="modelOptions"
            :label="t('settings.ai.modelHeavy')"
            density="compact"
            clearable
            :placeholder="t('settings.ai.envDefault')"
            persistent-placeholder
          />
          <v-text-field
            v-model.number="draft.monthlyTokenBudget"
            :label="t('settings.ai.budget')"
            type="number"
            min="0"
            density="compact"
            clearable
            :placeholder="t('settings.ai.unlimited')"
            persistent-placeholder
          />
        </div>
      </SettingsCard>

      <!-- API key -->
      <SettingsCard
        :title="t('settings.ai.key.title')"
        :description="t('settings.ai.key.desc')"
        icon="mdi-key-variant"
      >
        <div class="cp-ai-settings__key">
          <div class="cp-ai-settings__key-status">
            <v-chip
              :color="data.key.status === 'unset' ? 'default' : 'success'"
              size="small"
              variant="tonal"
              label
            >
              {{ t(`settings.ai.key.status.${data.key.status}`) }}
            </v-chip>
            <code v-if="data.key.lastFour" class="cp-ai-settings__masked">••••••{{ data.key.lastFour }}</code>
            <span v-if="envManaged" class="cp-ai-settings__reason">
              {{ t('settings.ai.key.envManaged') }}
            </span>
          </div>

          <p v-if="keyMgmtOff && !envManaged" class="cp-ai-settings__note">
            {{ t('settings.ai.key.mgmtDisabled') }}
          </p>

          <template v-else-if="!envManaged">
            <div v-if="showKeyField" class="cp-ai-settings__key-edit">
              <v-text-field
                v-model="keyInput"
                :label="t('settings.ai.key.inputLabel')"
                type="password"
                density="compact"
                autocomplete="off"
                hide-details
                :placeholder="'sk-or-...'"
              />
              <v-btn color="primary" variant="flat" size="small" :loading="saving" @click="saveKey">
                {{ t('settings.ai.key.validateSave') }}
              </v-btn>
              <v-btn variant="text" size="small" :disabled="saving" @click="showKeyField = false">
                {{ t('common.cancel') }}
              </v-btn>
            </div>
            <div v-else class="cp-ai-settings__key-actions">
              <v-btn variant="tonal" size="small" prepend-icon="mdi-key-plus" @click="showKeyField = true">
                {{ data.key.status === 'set_db' ? t('settings.ai.key.change') : t('settings.ai.key.set') }}
              </v-btn>
              <v-btn
                v-if="data.key.status === 'set_db'"
                variant="text"
                size="small"
                color="error"
                :disabled="saving"
                @click="removeKey"
              >
                {{ t('settings.ai.key.remove') }}
              </v-btn>
            </div>
          </template>
        </div>
      </SettingsCard>

      <!-- Monthly usage (read-only) -->
      <SettingsCard
        v-if="usage"
        :title="t('settings.ai.usageTitle')"
        :description="t('settings.ai.usageDesc')"
        icon="mdi-chart-donut"
      >
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
            :color="usage.overBudget ? 'error' : budgetPercent >= 80 ? 'warning' : 'success'"
            height="8"
            rounded
          />
          <div class="cp-ai-settings__bar-meta">
            <span>{{ budgetPercent }}%</span>
            <span v-if="usage.overBudget" class="cp-ai-settings__over">{{ t('settings.ai.overBudget') }}</span>
          </div>
        </div>
        <table v-if="usage.byOperation.length" class="cp-ai-settings__ops">
          <tbody>
            <tr v-for="op in usage.byOperation" :key="op.operationType">
              <td>{{ opLabel(op.operationType) }}</td>
              <td class="text-end">{{ fmtNum(op.count) }}</td>
              <td class="text-end">{{ fmtNum(op.tokens) }}</td>
            </tr>
          </tbody>
        </table>
      </SettingsCard>
    </template>

    <div v-else-if="loading" class="pa-3">
      <v-skeleton-loader type="article" />
    </div>
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
.cp-ai-settings__label {
  font-size: 0.76rem;
  font-weight: 500;
  color: var(--cp-text-muted);
  margin-bottom: 4px;
}
.cp-ai-settings__features {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 0 16px;
}
.cp-ai-settings__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px 12px;
  margin-top: 4px;
}
.cp-ai-settings__key {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cp-ai-settings__key-status {
  display: flex;
  align-items: center;
  gap: 10px;
}
.cp-ai-settings__masked {
  font-family: monospace;
  font-size: 0.8rem;
  direction: ltr;
}
.cp-ai-settings__key-edit,
.cp-ai-settings__key-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.cp-ai-settings__note {
  margin: 0;
  font-size: 0.74rem;
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
.cp-ai-settings__ops td {
  padding: 4px 6px;
  border-block-end: 1px solid var(--cp-border);
  font-variant-numeric: tabular-nums;
}
</style>
