// ============================================================
// Speech-to-Text adapter (المرحلة الأولى).
//
// Wraps the browser Web Speech API behind a small reactive port. The rest of
// the app depends only on { isSupported, isListening, transcript, start, stop } —
// so swapping to a cloud STT (Whisper, Azure, …) later means rewriting only this
// file. STT runs in the browser; only the final TEXT is sent to the backend.
// ============================================================

import { onBeforeUnmount, ref, shallowRef } from 'vue';

// Minimal typings — the DOM lib does not ship SpeechRecognition types.
interface SpeechRecognitionResultLike {
  0: { transcript: string };
  isFinal: boolean;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  const w = globalThis as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UseSpeechRecognitionOptions {
  /** BCP-47 tag. Iraqi Arabic first; many engines fall back to MSA automatically. */
  lang?: string;
  /** Called once a final transcript is available. */
  onFinal?: (text: string) => void;
}

export function useSpeechRecognition(options: UseSpeechRecognitionOptions = {}) {
  const Ctor = getCtor();
  const isSupported = ref(Ctor !== null);
  const isListening = ref(false);
  const transcript = ref('');
  const interim = ref('');
  const error = ref<string | null>(null);

  const recognition = shallowRef<SpeechRecognitionLike | null>(null);

  function ensure(): SpeechRecognitionLike | null {
    if (!Ctor) return null;
    if (recognition.value) return recognition.value;
    const rec = new Ctor();
    rec.lang = options.lang ?? 'ar-IQ';
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      let finalText = '';
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (!res) continue;
        if (res.isFinal) finalText += res[0].transcript;
        else interimText += res[0].transcript;
      }
      interim.value = interimText;
      if (finalText) {
        transcript.value = finalText.trim();
        interim.value = '';
        options.onFinal?.(transcript.value);
      }
    };
    rec.onerror = (e) => {
      error.value = e.error;
      isListening.value = false;
    };
    rec.onend = () => {
      isListening.value = false;
    };

    recognition.value = rec;
    return rec;
  }

  function start(): void {
    error.value = null;
    transcript.value = '';
    interim.value = '';
    const rec = ensure();
    if (!rec) {
      error.value = 'unsupported';
      return;
    }
    try {
      rec.start();
      isListening.value = true;
    } catch {
      // start() throws if already running — ignore.
    }
  }

  function stop(): void {
    recognition.value?.stop();
    isListening.value = false;
  }

  onBeforeUnmount(() => {
    recognition.value?.abort();
  });

  return { isSupported, isListening, transcript, interim, error, start, stop };
}
