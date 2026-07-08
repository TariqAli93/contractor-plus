<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { aiCommandApi, type AiLlmSettingsUpdate } from '@/services/api/aiCommand.api';
import { t } from '@/i18n';
import { llmErrorMessage } from '@/services/llmErrorMessages';
import type {
  AiLlmSettingsView,
  AiLlmTestConnectionResult,
  OpenRouterModel,
} from '@contractor-plus/shared';

const loading = ref(true);
const saving = ref(false);
const testing = ref(false);
const view = ref<AiLlmSettingsView | null>(null);
const testResult = ref<AiLlmTestConnectionResult | null>(null);
const error = ref<string | null>(null);

// Model catalog (fetched from the backend, never from OpenRouter directly).
const models = ref<OpenRouterModel[]>([]);
const modelsLoading = ref(false);
const modelsStale = ref(false);
const modelsError = ref(false);

const form = reactive<{
  enabled: boolean;
  model: string;
  apiKey: string;
  timeoutMs: number;
  maxTokens: number;
}>({ enabled: false, model: '', apiKey: '', timeoutMs: 15000, maxTokens: 1500 });

function msg(e: unknown): string {
  return e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : 'حدث خطأ';
}

const selectedModel = computed(() => models.value.find((m) => m.id === form.model) ?? null);

function formatPrice(perToken: string | null): string | null {
  if (perToken == null) return null;
  const n = Number(perToken);
  if (!Number.isFinite(n)) return null;
  if (n === 0) return t('settings.ai.free');
  // OpenRouter reports USD per token; show USD per 1M tokens for readability.
  const perMillion = n * 1_000_000;
  return `$${perMillion.toFixed(perMillion < 1 ? 3 : 2)} / مليون رمز`;
}

function contextLabel(m: OpenRouterModel): string | null {
  if (m.contextLength == null) return null;
  return `${(m.contextLength / 1000).toFixed(0)}K سياق`;
}

async function loadModels() {
  modelsLoading.value = true;
  modelsError.value = false;
  try {
    const res = await aiCommandApi.listModels();
    models.value = res.models;
    modelsStale.value = res.stale;
    modelsError.value = res.models.length === 0;
  } catch {
    modelsError.value = true;
  } finally {
    modelsLoading.value = false;
  }
}

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const v = await aiCommandApi.getSettings();
    view.value = v;
    form.enabled = v.enabled;
    form.model = v.model;
    form.timeoutMs = v.timeoutMs;
    form.maxTokens = v.maxTokens;
    form.apiKey = '';
  } catch (e) {
    error.value = msg(e);
  } finally {
    loading.value = false;
  }
  void loadModels();
}

async function save() {
  saving.value = true;
  error.value = null;
  testResult.value = null;
  try {
    const patch: AiLlmSettingsUpdate = {
      enabled: form.enabled,
      model: form.model,
      timeoutMs: form.timeoutMs,
      maxTokens: form.maxTokens,
    };
    if (form.apiKey.trim()) patch.apiKey = form.apiKey.trim();
    view.value = await aiCommandApi.updateSettings(patch);
    form.apiKey = '';
  } catch (e) {
    error.value = msg(e);
  } finally {
    saving.value = false;
  }
}

async function test() {
  testing.value = true;
  testResult.value = null;
  error.value = null;
  try {
    testResult.value = await aiCommandApi.testConnection({
      model: form.model,
      apiKey: form.apiKey.trim() || undefined,
      timeoutMs: form.timeoutMs,
    });
  } catch (e) {
    error.value = msg(e);
  } finally {
    testing.value = false;
  }
}

async function clearKey() {
  saving.value = true;
  error.value = null;
  try {
    view.value = await aiCommandApi.updateSettings({ clearApiKey: true });
    form.apiKey = '';
  } catch (e) {
    error.value = msg(e);
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="cp-panel">
    <div class="p-4" style="max-width: 640px">
      <v-alert type="info" variant="tonal" density="comfortable" class="mb-4 text-sm">
        {{ t('settings.ai.description') }} {{ t('settings.ai.apiKeyEncrypted') }}
      </v-alert>

      <v-skeleton-loader v-if="loading" type="article" />

      <template v-else>
        <v-switch
          v-model="form.enabled"
          color="primary"
          :label="t('settings.ai.enable')"
          density="comfortable"
          hide-details
          class="mb-2"
        />

        <!-- Provider is fixed to OpenRouter — no dropdown, just a status row. -->
        <div class="flex items-center gap-2 mb-3">
          <v-icon icon="mdi-cloud-outline" size="small" />
          <span class="text-sm font-medium">{{ t('settings.ai.provider') }}</span>
          <v-chip :color="view?.effective ? 'success' : 'warning'" size="x-small" variant="tonal">
            {{ view?.effective ? 'فعّال' : 'غير مُفعّل' }}
          </v-chip>
        </div>

        <v-autocomplete
          v-model="form.model"
          :items="models"
          item-title="name"
          item-value="id"
          :label="t('settings.ai.model')"
          :placeholder="t('settings.ai.selectModel')"
          :loading="modelsLoading"
          density="comfortable"
          variant="outlined"
          class="mb-1"
          hide-details
          :no-data-text="modelsLoading ? t('settings.ai.loadingModels') : 'لا توجد نماذج'"
        >
          <template #item="{ props, item }">
            <v-list-item v-bind="props" :subtitle="item.raw.id">
              <template #append>
                <v-chip v-if="item.raw.isFree" color="success" size="x-small" variant="tonal">{{ t('settings.ai.free') }}</v-chip>
              </template>
            </v-list-item>
          </template>
        </v-autocomplete>

        <!-- Fallback when the catalog can't be loaded — a free-text id still works. -->
        <div v-if="modelsError" class="mb-3">
          <v-alert type="warning" variant="tonal" density="compact" class="text-xs mb-1">
            {{ t('settings.ai.modelsError') }}
          </v-alert>
          <v-text-field
            v-model="form.model"
            :label="t('settings.ai.model')"
            placeholder="openai/gpt-4o-mini"
            density="comfortable"
            variant="outlined"
            hide-details
          />
        </div>
        <div v-else-if="modelsStale" class="text-xs text-medium-emphasis mb-3">
          {{ t('settings.ai.modelsStale') }}
        </div>
        <div v-else class="mb-3" />

        <!-- Selected-model metadata -->
        <div v-if="selectedModel" class="mb-3 flex flex-wrap gap-2">
          <v-chip v-if="contextLabel(selectedModel)" size="small" variant="tonal">
            {{ contextLabel(selectedModel) }}
          </v-chip>
          <v-chip v-if="formatPrice(selectedModel.pricing?.prompt ?? null)" size="small" variant="tonal">
            {{ t('settings.ai.priceInput') }}: {{ formatPrice(selectedModel.pricing?.prompt ?? null) }}
          </v-chip>
          <v-chip v-if="formatPrice(selectedModel.pricing?.completion ?? null)" size="small" variant="tonal">
            {{ t('settings.ai.priceOutput') }}: {{ formatPrice(selectedModel.pricing?.completion ?? null) }}
          </v-chip>
          <v-chip
            v-for="mod in selectedModel.inputModalities"
            :key="mod"
            size="small"
            variant="outlined"
          >
            {{ mod === 'image' ? 'صورة' : mod === 'text' ? 'نص' : mod }}
          </v-chip>
          <v-chip v-if="selectedModel.supportedParameters.includes('tools')" size="small" color="primary" variant="tonal">
            أدوات
          </v-chip>
          <v-chip v-if="selectedModel.isFree" size="small" color="success" variant="tonal">{{ t('settings.ai.free') }}</v-chip>
        </div>

        <v-text-field
          v-model="form.apiKey"
          :label="view?.apiKeySet ? t('settings.ai.apiKeySet') : t('settings.ai.apiKey')"
          :placeholder="t('settings.ai.apiKeyPlaceholder')"
          type="password"
          autocomplete="off"
          density="comfortable"
          variant="outlined"
          class="mb-3"
          hide-details
        />

        <div class="flex gap-3 mb-3">
          <v-text-field
            v-model.number="form.timeoutMs"
            :label="t('settings.ai.timeout')"
            type="number"
            density="comfortable"
            variant="outlined"
            hide-details
          />
          <v-text-field
            v-model.number="form.maxTokens"
            :label="t('settings.ai.maxTokens')"
            type="number"
            density="comfortable"
            variant="outlined"
            hide-details
          />
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <v-btn color="primary" :loading="saving" @click="save">{{ t('settings.ai.save') }}</v-btn>
          <v-btn variant="tonal" :loading="testing" @click="test">{{ t('settings.ai.test') }}</v-btn>
          <v-btn
            v-if="view?.apiKeySet"
            variant="text"
            color="error"
            :loading="saving"
            @click="clearKey"
          >
            {{ t('settings.ai.clearKey') }}
          </v-btn>
        </div>

        <v-alert
          v-if="testResult"
          :type="testResult.ok ? 'success' : 'error'"
          variant="tonal"
          density="comfortable"
          class="mt-4 text-sm"
        >
          {{
            testResult.ok
              ? `${t('settings.ai.testOk')} — ${t('settings.ai.latencyLabel')}: ${testResult.latencyMs}ms`
              : llmErrorMessage(testResult.error)
          }}
        </v-alert>

        <v-alert v-if="error" type="error" variant="tonal" density="comfortable" class="mt-4 text-sm">
          {{ error }}
        </v-alert>
      </template>
    </div>
  </div>
</template>
