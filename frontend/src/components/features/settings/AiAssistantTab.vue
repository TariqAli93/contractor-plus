<script setup lang="ts">
// Settings → المساعد الذكي. Configures the LLM behind the voice/command
// assistant against the existing, secure backend (/voice/settings):
//  - enable/disable (when off, the assistant still works via local rules)
//  - provider (Anthropic / OpenAI / Groq), model
//  - API key — write-only: we send a new key to be encrypted server-side and
//    only ever read back `apiKeySet` (the key itself never returns to the UI)
//  - test connection, plus advanced timeout / max-tokens
// Gated by settings.voice_ai.manage; the whole Settings area is OWNER/ADMIN.
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { t } from '@/i18n';
import { voiceApi, type VoiceAiProvider, type VoiceAiSettings } from '@/services/api/voice.api';
import { useToast } from '@/composables/useToast';
import { useApiError } from '@/composables/useApiError';
import { useAccess } from '@/composables/useAccess';
import { RoleName } from '@/types/enums';
import SettingsCard from './SettingsCard.vue';
import AdvancedOptions from '@/components/shared/AdvancedOptions.vue';
import ErrorState from '@/components/shared/ErrorState.vue';

const toast = useToast();
const { handle } = useApiError();
const { canAccess } = useAccess();

const canManage = computed(() =>
  canAccess({ permissions: ['settings.voice_ai.manage'], roles: [RoleName.OWNER, RoleName.ADMIN] }),
);

const loading = ref(false);
const saving = ref(false);
const testing = ref(false);
const error = ref<unknown>(null);

// Loaded server view — source of truth for apiKeySet / effective.
const view = ref<VoiceAiSettings | null>(null);

interface FormState {
  enabled: boolean;
  provider: VoiceAiProvider;
  model: string;
  timeoutMs: number;
  maxTokens: number;
  apiKey: string; // write-only; empty = keep the existing key
  clearApiKey: boolean;
}
const form = reactive<FormState>({
  enabled: false,
  provider: 'anthropic',
  model: '',
  timeoutMs: 6000,
  maxTokens: 700,
  apiKey: '',
  clearApiKey: false,
});

const testResult = ref<{ ok: boolean; reason?: string; latencyMs?: number } | null>(null);

// Throttle: at most one test-connection every 10s, so the settings screen can't
// hammer the provider's rate limit.
const TEST_COOLDOWN_MS = 10_000;
const lastTestAt = ref(0);

// Default model per provider (mirrors the backend DEFAULT_MODELS). Drives the
// field placeholder and the auto-fill when the provider changes with an empty field.
const DEFAULT_MODELS: Record<VoiceAiProvider, string> = {
  anthropic: 'claude-haiku-4-5',
  openai: 'gpt-4o-mini',
  groq: 'llama-3.3-70b-versatile',
};

const providerOptions = computed(() => [
  { value: 'anthropic', title: t('settings.ai.providers.anthropic') },
  { value: 'openai', title: t('settings.ai.providers.openai') },
  { value: 'groq', title: t('settings.ai.providers.groq') },
]);

const modelPlaceholder = computed(() => DEFAULT_MODELS[form.provider]);

// When the user switches provider, prefill its default model — but ONLY if the
// field is empty, so a custom model the user typed is never clobbered.
watch(
  () => form.provider,
  (provider) => {
    if (!form.model.trim()) form.model = DEFAULT_MODELS[provider];
  },
);

// Mirror the backend rule so an invalid OpenAI model is caught inline, before
// the save round-trip. OpenAI ids are lowercase and start with gpt-/o/chatgpt-.
function isValidOpenAiModel(model: string): boolean {
  const m = model.trim().toLowerCase();
  return m.startsWith('gpt-') || m.startsWith('o') || m.startsWith('chatgpt-');
}
const modelRule = (v: string) =>
  form.provider !== 'openai' ||
  !v?.trim() ||
  isValidOpenAiModel(v) ||
  t('settings.ai.errors.invalidOpenaiModel');

// What will actually happen right now, in plain language.
const statusKind = computed<'active' | 'noKey' | 'off'>(() => {
  if (!form.enabled) return 'off';
  const hasKey = (!!view.value?.apiKeySet && !form.clearApiKey) || !!form.apiKey.trim();
  return hasKey ? 'active' : 'noKey';
});

const apiKeyHint = computed(() =>
  view.value?.apiKeySet && !form.clearApiKey
    ? t('settings.ai.apiKeySet')
    : t('settings.ai.apiKeyEncrypted'),
);

function applyView(v: VoiceAiSettings) {
  view.value = v;
  form.enabled = v.enabled;
  form.provider = v.provider;
  form.model = v.model;
  form.timeoutMs = v.timeoutMs;
  form.maxTokens = v.maxTokens;
  form.apiKey = '';
  form.clearApiKey = false;
  testResult.value = null;
}

async function load() {
  loading.value = true;
  error.value = null;
  try {
    applyView(await voiceApi.getSettings());
  } catch (e) {
    error.value = e;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

// Map the backend's unified, provider-agnostic error code (invalid_api_key,
// rate_limited, …) to a plain "what's wrong" message — no raw codes reach the user.
function friendlyTestError(code: string | undefined): string {
  switch ((code ?? '').toLowerCase()) {
    case 'no_api_key':
      return t('settings.ai.testErrors.noKey');
    case 'invalid_api_key':
      return t('settings.ai.testErrors.badKey');
    case 'insufficient_quota':
      return t('settings.ai.testErrors.quota');
    case 'rate_limited':
      return t('settings.ai.testErrors.rateLimited');
    case 'model_not_found':
      return t('settings.ai.testErrors.modelNotFound');
    case 'timeout':
      return t('settings.ai.testErrors.timeout');
    case 'network_error':
      return t('settings.ai.testErrors.network');
    case 'server_error':
      return t('settings.ai.testErrors.server');
    case 'client_unavailable':
      return t('settings.ai.testErrors.unavailable');
    default:
      return t('settings.ai.testErrors.generic');
  }
}

async function testConnection() {
  const now = Date.now();
  if (now - lastTestAt.value < TEST_COOLDOWN_MS) {
    testResult.value = { ok: false, reason: t('settings.ai.testErrors.cooldown') };
    return;
  }
  lastTestAt.value = now;
  testing.value = true;
  testResult.value = null;
  try {
    const res = await voiceApi.testConnection({
      provider: form.provider,
      model: form.model.trim() || undefined,
      apiKey: form.apiKey.trim() || undefined,
      timeoutMs: form.timeoutMs,
    });
    testResult.value = res.ok
      ? { ok: true, latencyMs: res.latencyMs }
      : { ok: false, reason: friendlyTestError(res.error), latencyMs: res.latencyMs };
  } catch (e) {
    handle(e);
  } finally {
    testing.value = false;
  }
}

async function save() {
  const model = form.provider === 'openai' ? form.model.trim().toLowerCase() : form.model.trim();
  if (model && form.provider === 'openai' && !isValidOpenAiModel(model)) {
    toast.error(t('settings.ai.errors.invalidOpenaiModel'));
    return;
  }
  saving.value = true;
  try {
    const patch = {
      enabled: form.enabled,
      provider: form.provider,
      model: model || undefined,
      timeoutMs: form.timeoutMs,
      maxTokens: form.maxTokens,
      ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
      ...(form.clearApiKey ? { clearApiKey: true } : {}),
    };
    applyView(await voiceApi.updateSettings(patch));
    toast.success(t('settings.ai.saved'));
  } catch (e) {
    handle(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <SettingsCard
    :title="t('settings.ai.title')"
    :description="t('settings.ai.description')"
    icon="mdi-robot-outline"
  >
    <ErrorState v-if="error" :error="error" @retry="load" />

    <div v-else-if="loading && !view" class="space-y-2">
      <v-skeleton-loader type="article" />
    </div>

    <div v-else class="cp-ai-form">
      <!-- Live status: exactly what happens right now. -->
      <v-alert
        :type="statusKind === 'active' ? 'success' : statusKind === 'noKey' ? 'warning' : 'info'"
        variant="tonal"
        density="comfortable"
        :icon="
          statusKind === 'active'
            ? 'mdi-check-circle-outline'
            : statusKind === 'noKey'
              ? 'mdi-key-alert-outline'
              : 'mdi-shield-outline'
        "
        class="mb-4"
      >
        {{ t('settings.ai.status.' + statusKind) }}
      </v-alert>

      <v-switch
        v-model="form.enabled"
        :label="t('settings.ai.enable')"
        :hint="t('settings.ai.enableHint')"
        persistent-hint
        color="primary"
        :disabled="!canManage"
        inset
      />

      <div v-if="form.enabled" class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        <v-select
          v-model="form.provider"
          :items="providerOptions"
          :label="t('settings.ai.provider')"
          :disabled="!canManage"
        />
        <v-text-field
          v-model="form.model"
          :label="t('settings.ai.model')"
          :placeholder="modelPlaceholder"
          :rules="[modelRule]"
          :disabled="!canManage"
        />
        <v-text-field
          v-model="form.apiKey"
          :label="t('settings.ai.apiKey')"
          :placeholder="view?.apiKeySet ? t('settings.ai.apiKeySet') : t('settings.ai.apiKeyPlaceholder')"
          type="password"
          autocomplete="off"
          prepend-inner-icon="mdi-key-outline"
          :disabled="!canManage || form.clearApiKey"
          :hint="apiKeyHint"
          persistent-hint
          class="md:col-span-2"
        />
        <v-checkbox
          v-if="view?.apiKeySet"
          v-model="form.clearApiKey"
          :label="t('settings.ai.clearKey')"
          :disabled="!canManage"
          density="compact"
          hide-details
          class="md:col-span-2"
        />

        <AdvancedOptions>
          <v-text-field
            v-model.number="form.timeoutMs"
            :label="t('settings.ai.timeout')"
            type="number"
            min="1000"
            max="60000"
            step="500"
            :disabled="!canManage"
          />
          <v-text-field
            v-model.number="form.maxTokens"
            :label="t('settings.ai.maxTokens')"
            type="number"
            min="64"
            max="4000"
            step="50"
            :disabled="!canManage"
          />
        </AdvancedOptions>
      </div>

      <!-- Test-connection result. -->
      <v-alert
        v-if="testResult"
        :type="testResult.ok ? 'success' : 'error'"
        variant="tonal"
        density="compact"
        class="mt-3"
      >
        <div class="d-flex align-center flex-wrap ga-2">
          <span>{{ testResult.ok ? t('settings.ai.testOk') : testResult.reason }}</span>
          <span v-if="testResult.latencyMs != null" class="text-caption opacity-80">
            · {{ t('settings.ai.latencyLabel') }}: {{ testResult.latencyMs }}ms
          </span>
        </div>
      </v-alert>

      <div class="flex items-center gap-2 mt-4 flex-wrap">
        <v-btn
          v-if="form.enabled"
          variant="tonal"
          prepend-icon="mdi-connection"
          :loading="testing"
          :disabled="!canManage"
          @click="testConnection"
        >
          {{ t('settings.ai.test') }}
        </v-btn>
        <v-spacer />
        <v-btn
          color="primary"
          variant="flat"
          prepend-icon="mdi-content-save-outline"
          :loading="saving"
          :disabled="!canManage"
          @click="save"
        >
          {{ t('settings.ai.save') }}
        </v-btn>
      </div>
    </div>
  </SettingsCard>
</template>
