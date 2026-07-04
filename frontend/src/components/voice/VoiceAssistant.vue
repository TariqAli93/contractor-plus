<script setup lang="ts">
// ============================================================
// Voice Assistant — the conversational UI shell.
//
// Orchestrates: STT (useSpeechRecognition) → store.submit → render the turn
// (clarify / confirm / executed / rejected) → perform client actions
// (navigation, toast) and optional TTS feedback. All policy lives on the
// backend; this component only captures speech and renders the response.
// ============================================================
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { ClientAction, VoiceTurnResponse } from '@contractor-plus/shared';
import { useVoiceStore } from '@/stores/voice.store';
import { useSpeechRecognition } from '@/composables/useSpeechRecognition';
import { useAccess } from '@/composables/useAccess';
import { useToast } from '@/composables/useToast';
import { useUiStore } from '@/stores/ui.store';

const router = useRouter();
const toast = useToast();
const { canAccess } = useAccess();
const voice = useVoiceStore();
const ui = useUiStore();

const canUse = computed(() => canAccess({ permissions: ['voice.use'] }));

const open = ref(false);
const textInput = ref('');
const busy = computed(() => voice.status === 'processing');

const stt = useSpeechRecognition({
  lang: 'ar-IQ',
  onFinal: (text) => {
    void handleSubmit(text);
  },
});

function speak(text: string): void {
  const synth = globalThis.speechSynthesis;
  if (!synth) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ar';
  synth.cancel();
  synth.speak(u);
}

function performClientActions(actions: ClientAction[]): void {
  for (const action of actions) {
    if (action.type === 'navigate') void router.push(action.to);
    else if (action.type === 'toast') toast[action.level](action.message);
    else if (action.type === 'open_palette') {
      open.value = false; // step aside so the palette is unobstructed
      ui.openPalette(action.query ?? '');
    }
  }
}

function react(res: VoiceTurnResponse): void {
  switch (res.kind) {
    case 'clarify':
      speak(res.question);
      // Auto-listen again so the user can answer hands-free.
      if (stt.isSupported.value) window.setTimeout(() => stt.start(), 350);
      break;
    case 'confirm':
      speak(`${res.summary.title}. هل تريد التنفيذ؟`);
      break;
    case 'executed':
      performClientActions(res.clientActions);
      if (res.result.createdEntities.length || res.clientActions.length) {
        toast.success(res.result.message);
      }
      speak(res.result.message);
      break;
    case 'rejected':
      toast.error(res.message);
      speak(res.message);
      break;
  }
}

function reportError(err: unknown): void {
  const message = (err as { message?: string })?.message ?? 'تعذّر تنفيذ الأمر.';
  voice.reset();
  toast.error(message);
  speak(message);
}

async function handleSubmit(text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  textInput.value = '';
  try {
    react(await voice.submit(trimmed));
  } catch (err) {
    reportError(err);
  }
}

async function confirm(): Promise<void> {
  try {
    const res = await voice.decide('confirm');
    if (res) react(res);
  } catch (err) {
    reportError(err);
  }
}

async function cancel(): Promise<void> {
  try {
    const res = await voice.decide('cancel');
    if (res) react(res);
  } catch (err) {
    reportError(err);
  }
}

function toggleMic(): void {
  if (stt.isListening.value) stt.stop();
  else stt.start();
}

function togglePanel(): void {
  open.value = !open.value;
}
</script>

<template>
  <div v-if="canUse" class="voice-assistant" dir="rtl">
    <!-- Conversation panel -->
    <v-card v-if="open" class="voice-panel mb-3" elevation="8" width="360">
      <v-toolbar density="comfortable" color="primary">
        <v-icon icon="mdi-robot-outline" class="ms-3 me-2" />
        <v-toolbar-title class="text-body-1 font-weight-bold">المساعد الصوتي</v-toolbar-title>
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" size="small" @click="togglePanel" />
      </v-toolbar>

      <div class="voice-body pa-3">
        <p v-if="voice.history.length === 0" class="text-medium-emphasis text-body-2 text-center py-6">
          قل أمرك… مثل: «سوي مشروع بيت مساحة 100»، «أضف مصروف 500 ألف»، «افتح مشروع فيلا أحمد»،
          «ابحث عن أحمد»، أو «أنجز المشروع». قل «مساعدة» لعرض كل الأوامر.
        </p>

        <div
          v-for="(turn, i) in voice.history"
          :key="i"
          class="voice-bubble mb-2"
          :class="turn.role === 'user' ? 'voice-bubble--user' : 'voice-bubble--assistant'"
        >
          {{ turn.text }}
        </div>

        <p v-if="stt.interim.value" class="text-medium-emphasis text-body-2 fst-italic">
          {{ stt.interim.value }}…
        </p>

        <!-- Confirmation card -->
        <v-card v-if="voice.status === 'confirming' && voice.confirmation" variant="tonal" color="warning" class="mt-2">
          <v-card-title class="text-body-1">{{ voice.confirmation.title }}</v-card-title>
          <v-list density="compact" bg-color="transparent">
            <v-list-item v-for="(line, idx) in voice.confirmation.lines" :key="idx">
              <template #title>
                <span class="text-medium-emphasis">{{ line.label }}:</span>
                <strong class="ms-1">{{ line.value }}</strong>
              </template>
            </v-list-item>
          </v-list>
          <v-card-actions>
            <v-btn color="success" variant="flat" :loading="busy" prepend-icon="mdi-check" @click="confirm">
              تأكيد
            </v-btn>
            <v-btn color="error" variant="text" :disabled="busy" prepend-icon="mdi-cancel" @click="cancel">
              إلغاء
            </v-btn>
          </v-card-actions>
        </v-card>
      </div>

      <v-divider />
      <div class="pa-2 d-flex align-center ga-2">
        <v-btn
          :icon="stt.isListening.value ? 'mdi-microphone' : 'mdi-microphone-off'"
          :color="stt.isListening.value ? 'error' : 'primary'"
          :disabled="!stt.isSupported.value || busy"
          variant="tonal"
          @click="toggleMic"
        />
        <v-text-field
          v-model="textInput"
          density="compact"
          hide-details
          placeholder="أو اكتب الأمر…"
          :loading="busy"
          @keyup.enter="handleSubmit(textInput)"
        />
        <v-btn icon="mdi-send" variant="text" :disabled="busy || !textInput" @click="handleSubmit(textInput)" />
      </div>
      <p v-if="!stt.isSupported.value" class="text-caption text-medium-emphasis px-3 pb-2">
        التعرّف الصوتي غير مدعوم في هذا المتصفح — استخدم الإدخال النصي.
      </p>
    </v-card>

    <!-- Floating mic / open button -->
    <v-btn
      class="voice-fab"
      :icon="open ? 'mdi-creation' : 'mdi-microphone'"
      color="primary"
      size="large"
      elevation="6"
      @click="togglePanel"
    />
  </div>
</template>

<style scoped>
.voice-assistant {
  position: fixed;
  bottom: 24px;
  inset-inline-start: 24px;
  z-index: 2000;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.voice-panel {
  max-height: 70vh;
  display: flex;
  flex-direction: column;
}
.voice-body {
  overflow-y: auto;
}
.voice-bubble {
  padding: 8px 12px;
  border-radius: 12px;
  max-width: 85%;
  font-size: 0.9rem;
  line-height: 1.5;
  white-space: pre-wrap;
}
.voice-bubble--user {
  background: rgba(var(--v-theme-primary), 0.12);
  margin-inline-start: auto;
}
.voice-bubble--assistant {
  background: rgba(var(--v-theme-on-surface), 0.06);
  margin-inline-end: auto;
}
.voice-fab {
  border-radius: 50%;
}
</style>
