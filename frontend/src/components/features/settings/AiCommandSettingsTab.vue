<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { aiCommandApi, type AiLlmSettingsUpdate } from '@/services/api/aiCommand.api';
import type {
  AiLlmProvider,
  AiLlmSettingsView,
  AiLlmTestConnectionResult,
} from '@contractor-plus/shared';

const loading = ref(true);
const saving = ref(false);
const testing = ref(false);
const view = ref<AiLlmSettingsView | null>(null);
const testResult = ref<AiLlmTestConnectionResult | null>(null);
const error = ref<string | null>(null);

const form = reactive<{
  enabled: boolean;
  provider: AiLlmProvider;
  model: string;
  apiKey: string;
  timeoutMs: number;
  maxTokens: number;
}>({ enabled: false, provider: 'anthropic', model: '', apiKey: '', timeoutMs: 15000, maxTokens: 1500 });

const providers: { value: AiLlmProvider; title: string }[] = [
  { value: 'anthropic', title: 'Anthropic (Claude)' },
  { value: 'openai', title: 'OpenAI' },
  { value: 'gemini', title: 'Google Gemini' },
  { value: 'openrouter', title: 'OpenRouter' },
  { value: 'groq', title: 'Groq' },
];

function msg(e: unknown): string {
  return e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : 'حدث خطأ';
}

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const v = await aiCommandApi.getSettings();
    view.value = v;
    form.enabled = v.enabled;
    form.provider = v.provider;
    form.model = v.model;
    form.timeoutMs = v.timeoutMs;
    form.maxTokens = v.maxTokens;
    form.apiKey = '';
  } catch (e) {
    error.value = msg(e);
  } finally {
    loading.value = false;
  }
}

async function save() {
  saving.value = true;
  error.value = null;
  testResult.value = null;
  try {
    const patch: AiLlmSettingsUpdate = {
      enabled: form.enabled,
      provider: form.provider,
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
      provider: form.provider,
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
        مساعد الأوامر الذكي يفهم أوامرك المكتوبة بالعربية ويحوّلها إلى خطة تنفيذ، ثم يطلب تأكيدك قبل أي تغيير.
        المفتاح يُخزَّن مشفّراً ولا يظهر بعد الحفظ.
      </v-alert>

      <v-skeleton-loader v-if="loading" type="article" />

      <template v-else>
        <v-switch
          v-model="form.enabled"
          color="primary"
          label="تفعيل المساعد الذكي"
          density="comfortable"
          hide-details
          class="mb-2"
        />

        <v-select
          v-model="form.provider"
          :items="providers"
          item-title="title"
          item-value="value"
          label="المزوّد"
          density="comfortable"
          variant="outlined"
          class="mb-3"
          hide-details
        />

        <v-text-field
          v-model="form.model"
          label="اسم الموديل"
          placeholder="claude-haiku-4-5"
          density="comfortable"
          variant="outlined"
          class="mb-3"
          hide-details
        />

        <v-text-field
          v-model="form.apiKey"
          :label="view?.apiKeySet ? 'مفتاح API (محفوظ — اتركه فارغاً للإبقاء)' : 'مفتاح API'"
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
            label="المهلة (ms)"
            type="number"
            density="comfortable"
            variant="outlined"
            hide-details
          />
          <v-text-field
            v-model.number="form.maxTokens"
            label="أقصى عدد رموز"
            type="number"
            density="comfortable"
            variant="outlined"
            hide-details
          />
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <v-btn color="primary" :loading="saving" @click="save">حفظ</v-btn>
          <v-btn variant="tonal" :loading="testing" @click="test">اختبار الاتصال</v-btn>
          <v-btn
            v-if="view?.apiKeySet"
            variant="text"
            color="error"
            :loading="saving"
            @click="clearKey"
          >
            حذف المفتاح
          </v-btn>
          <v-chip
            v-if="view"
            :color="view.effective ? 'success' : 'warning'"
            size="small"
            variant="tonal"
          >
            {{ view.effective ? 'فعّال' : 'غير مُفعّل' }}
          </v-chip>
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
              ? `نجح الاتصال (${testResult.latencyMs} مللي ثانية).`
              : `فشل الاتصال: ${testResult.error}`
          }}
        </v-alert>

        <v-alert v-if="error" type="error" variant="tonal" density="comfortable" class="mt-4 text-sm">
          {{ error }}
        </v-alert>
      </template>
    </div>
  </div>
</template>
