<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { t, te } from '@/i18n';
import { useAiSettings } from '@/composables/useAiSettings';
import { useToast } from '@/composables/useToast';
import { useConfirm } from '@/composables/useConfirm';
import { ApiError } from '@/types/api';
import { AI_FEATURE_KEYS, type AiFeatureKey, type AiModelListItem } from '@/types/ai';
import SettingsCard from './SettingsCard.vue';
import ErrorState from '@/components/shared/ErrorState.vue';

// The AI control panel. The OpenRouter key is managed here (encrypted, DB-first;
// env is only a fallback). Models are chosen from the LIVE OpenRouter catalogue
// for the current key — there is no static list. The raw key is never displayed
// and never kept in state after it is sent.
const {
  data,
  models,
  modelsStale,
  loading,
  modelsLoading,
  saving,
  error,
  load,
  loadModels,
  update,
  saveModels,
  setKey,
  clearKey,
} = useAiSettings();
const toast = useToast();
const { confirm } = useConfirm();

onMounted(load);

// ----- general controls (system + features + budget) -----
const draft = reactive({
  systemEnabled: true,
  features: {} as Record<AiFeatureKey, boolean>,
  monthlyTokenBudget: null as number | null,
});

watch(
  data,
  (d) => {
    if (!d) return;
    draft.systemEnabled = d.systemEnabled;
    draft.features = { ...d.features };
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
    (draft.monthlyTokenBudget ?? null) !== (d.monthlyTokenBudget ?? null)
  );
});

async function saveGeneral() {
  try {
    await update({
      systemEnabled: draft.systemEnabled,
      features: { ...draft.features },
      monthlyTokenBudget: draft.monthlyTokenBudget,
    });
    toast.success(t('common.saved'));
  } catch (e) {
    toast.error(errMsg(e));
  }
}

function resetGeneral() {
  const d = data.value;
  if (!d) return;
  draft.systemEnabled = d.systemEnabled;
  draft.features = { ...d.features };
  draft.monthlyTokenBudget = d.monthlyTokenBudget;
}

// ----- model selection (from the live list) -----
const modelDraft = reactive({
  defaultModel: null as string | null,
  heavyModel: null as string | null,
});
const freeOnly = ref(false);

watch(
  data,
  (d) => {
    if (!d) return;
    modelDraft.defaultModel = d.modelDefault ?? null;
    modelDraft.heavyModel = d.modelHeavy ?? null;
  },
  { immediate: true },
);

const filteredModels = computed<AiModelListItem[]>(() =>
  freeOnly.value ? models.value.filter((m) => m.isFree) : models.value,
);

const modelsDirty = computed(() => {
  const d = data.value;
  if (!d) return false;
  return (
    (modelDraft.defaultModel ?? null) !== (d.modelDefault ?? null) ||
    (modelDraft.heavyModel ?? null) !== (d.modelHeavy ?? null)
  );
});

// A previously-chosen model that the current key can no longer reach — the user
// must pick a new one (we never keep an unavailable model selected silently).
const defaultUnavailable = computed(
  () =>
    !!data.value?.modelDefault &&
    models.value.length > 0 &&
    !models.value.some((m) => m.id === data.value!.modelDefault),
);

watch([models, () => data.value?.modelDefault], () => {
  if (defaultUnavailable.value && modelDraft.defaultModel === data.value?.modelDefault) {
    modelDraft.defaultModel = null; // deselect the vanished model
  }
});

async function refreshModels() {
  await loadModels(true);
  toast.info(t('settings.ai.models.refreshed'));
}

async function saveModelSelection() {
  if (!modelDraft.defaultModel) return;
  try {
    await saveModels(modelDraft.defaultModel, modelDraft.heavyModel);
    toast.success(t('settings.ai.models.saved'));
  } catch (e) {
    toast.error(errMsg(e));
  }
}

function fmtPrice(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 3 });
}
function fmtContext(ctx: number | null): string | null {
  if (ctx === null) return null;
  if (ctx >= 1_000_000) return `${(ctx / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 1 })}M`;
  if (ctx >= 1000) return `${Math.round(ctx / 1000)}K`;
  return String(ctx);
}

// ----- API key management -----
const keyInput = ref('');
const showKeyField = ref(false);

const keyMgmtOff = computed(() => data.value?.keyManagementEnabled === false);
const isEnvFallback = computed(() => data.value?.key.status === 'set_env');

async function saveKey() {
  const value = keyInput.value.trim();
  if (!value) return;
  try {
    const count = await setKey(value);
    keyInput.value = ''; // never retain the raw key
    showKeyField.value = false;
    toast.success(t('settings.ai.key.savedCount', { count }));
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

// ----- usage (read-only) -----
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

      <!-- API key (first — everything else needs it) -->
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
            <span v-if="data.modelCount !== null" class="cp-ai-settings__reason">
              {{ t('settings.ai.key.modelCount', { count: data.modelCount }) }}
            </span>
          </div>

          <p v-if="isEnvFallback" class="cp-ai-settings__note">{{ t('settings.ai.key.envFallback') }}</p>
          <p v-if="keyMgmtOff" class="cp-ai-settings__note">{{ t('settings.ai.key.mgmtDisabled') }}</p>

          <template v-if="!keyMgmtOff">
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

      <!-- Models (live from OpenRouter) -->
      <SettingsCard
        :title="t('settings.ai.models.title')"
        :description="t('settings.ai.models.desc')"
        icon="mdi-brain"
      >
        <template #action>
          <v-btn
            size="small"
            variant="text"
            prepend-icon="mdi-refresh"
            :loading="modelsLoading"
            :disabled="!data.configured"
            @click="refreshModels"
          >
            {{ t('settings.ai.models.refresh') }}
          </v-btn>
        </template>

        <p v-if="!data.configured" class="cp-ai-settings__note">
          {{ t('settings.ai.models.needKey') }}
        </p>

        <template v-else>
          <div class="cp-ai-settings__models-bar">
            <v-checkbox
              v-model="freeOnly"
              :label="t('settings.ai.models.freeOnly')"
              density="compact"
              hide-details
            />
            <v-chip v-if="modelsStale" size="x-small" color="warning" variant="tonal" label>
              {{ t('settings.ai.models.stale') }}
            </v-chip>
            <v-spacer />
            <span class="cp-ai-settings__reason">
              {{ t('settings.ai.models.count', { count: filteredModels.length }) }}
            </span>
          </div>

          <v-alert
            v-if="defaultUnavailable"
            type="warning"
            variant="tonal"
            density="compact"
            class="mb-2"
          >
            {{ t('settings.ai.models.unavailable') }}
          </v-alert>

          <div class="cp-ai-settings__grid">
            <v-autocomplete
              v-model="modelDraft.defaultModel"
              :items="filteredModels"
              item-title="displayName"
              item-value="id"
              :label="t('settings.ai.modelDefault')"
              :loading="modelsLoading"
              :no-data-text="t('settings.ai.models.empty')"
              density="compact"
              clearable
            >
              <template #item="{ props: itemProps, item }">
                <v-list-item v-bind="itemProps" :title="item.raw.displayName">
                  <template #subtitle>
                    <span class="cp-model-slug">{{ item.raw.id }}</span>
                    <span v-if="fmtContext(item.raw.contextLength)" class="cp-model-ctx">
                      · {{ fmtContext(item.raw.contextLength) }}
                    </span>
                  </template>
                  <template #append>
                    <span v-if="item.raw.isFree" class="cp-model-free">{{ t('settings.ai.models.free') }}</span>
                    <span
                      v-else-if="item.raw.promptPricePerMillion !== null"
                      class="cp-model-price"
                    >${{ fmtPrice(item.raw.promptPricePerMillion) }}/1M</span>
                  </template>
                </v-list-item>
              </template>
            </v-autocomplete>

            <v-autocomplete
              v-model="modelDraft.heavyModel"
              :items="filteredModels"
              item-title="displayName"
              item-value="id"
              :label="t('settings.ai.modelHeavy')"
              :loading="modelsLoading"
              :no-data-text="t('settings.ai.models.empty')"
              :placeholder="t('settings.ai.models.heavyFallback')"
              persistent-placeholder
              density="compact"
              clearable
            >
              <template #item="{ props: itemProps, item }">
                <v-list-item v-bind="itemProps" :title="item.raw.displayName">
                  <template #subtitle>
                    <span class="cp-model-slug">{{ item.raw.id }}</span>
                  </template>
                  <template #append>
                    <span v-if="item.raw.isFree" class="cp-model-free">{{ t('settings.ai.models.free') }}</span>
                    <span
                      v-else-if="item.raw.promptPricePerMillion !== null"
                      class="cp-model-price"
                    >${{ fmtPrice(item.raw.promptPricePerMillion) }}/1M</span>
                  </template>
                </v-list-item>
              </template>
            </v-autocomplete>
          </div>

          <div v-if="modelsDirty" class="cp-ai-settings__models-actions">
            <v-btn size="small" variant="text" :disabled="saving" @click="modelDraft.defaultModel = data.modelDefault ?? null; modelDraft.heavyModel = data.modelHeavy ?? null">
              {{ t('common.cancel') }}
            </v-btn>
            <v-btn
              size="small"
              color="primary"
              variant="flat"
              :loading="saving"
              :disabled="!modelDraft.defaultModel"
              @click="saveModelSelection"
            >
              {{ t('settings.ai.models.saveSelection') }}
            </v-btn>
          </div>
        </template>
      </SettingsCard>

      <!-- General controls (system + features + budget) -->
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
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 8px 12px;
  margin-top: 4px;
}
.cp-ai-settings__models-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 4px;
}
.cp-ai-settings__models-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 6px;
}
.cp-model-slug {
  font-family: monospace;
  font-size: 0.72rem;
  direction: ltr;
  display: inline-block;
}
.cp-model-ctx {
  font-size: 0.72rem;
  color: var(--cp-text-muted);
}
.cp-model-free {
  font-size: 0.68rem;
  font-weight: 600;
  color: rgb(var(--v-theme-success));
  border: 1px solid rgb(var(--v-theme-success));
  border-radius: var(--cp-radius-sm);
  padding: 0 6px;
}
.cp-model-price {
  font-size: 0.7rem;
  color: var(--cp-text-muted);
  font-variant-numeric: tabular-nums;
  direction: ltr;
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
  flex-wrap: wrap;
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
