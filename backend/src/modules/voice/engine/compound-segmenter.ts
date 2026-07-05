// ============================================================
// Multi-Intent Segmenter — المرحلة 1 (priority).
//
// Splits a compound utterance into independent, ordered intents:
//   "سوي مشروع جديد، أنشئ عقد باسم أحمد، أضف المواد، ثم أضف دفعة"
//     → [create_project, create_contract, generate_materials, add_payment]
//
// It splits on explicit connectors only (Arabic/Latin comma, ثم, بعدها, …) —
// never on a bare "و", which is part of many words. Each segment is run through
// the same NluProvider; recognised, registered intents are kept and ordered by
// the Intent Priority (requirement 7). The segmenter NEVER string-matches whole
// sentences and needs no per-intent code (maintainability).
// ============================================================

import { VoiceIntent, type EntityBag, type VoiceLocale } from '@contractor-plus/shared';
import type { NluProvider } from '../nlu/nlu.types.js';

// Explicit segment boundaries. `\bثم\b`-style word boundaries don't work for
// Arabic in JS regex, so connectors are matched with surrounding whitespace.
const CONNECTOR_RE = /،|,|؛|(?:\s|^)(?:ثم|بعدها|وبعدها|بعدين|وبعدين|وبعد\s+ذلك)(?:\s|$)/g;

// Requirement 7 — execution priority (lower runs first). Intents not listed are
// not workflow-eligible.
export const INTENT_PRIORITY: Partial<Record<VoiceIntent, number>> = {
  [VoiceIntent.CREATE_PROJECT]: 1,
  [VoiceIntent.CREATE_CONTRACT]: 2,
  [VoiceIntent.LINK_PROJECT_CONTRACT]: 3,
  [VoiceIntent.ADD_MATERIALS]: 3,
  [VoiceIntent.ADD_COST]: 4,
  [VoiceIntent.ADD_PAYMENT]: 5,
  [VoiceIntent.NAVIGATE]: 6,
  [VoiceIntent.OPEN_ENTITY]: 6,
};

export interface IntentInvocation {
  intent: VoiceIntent;
  bag: EntityBag;
  transcript: string;
  confidence: number;
}

/** True when the utterance contains an explicit connector (cheap pre-check). */
export function hasConnector(transcript: string): boolean {
  CONNECTOR_RE.lastIndex = 0;
  return CONNECTOR_RE.test(transcript);
}

export function splitSegments(transcript: string): string[] {
  return transcript
    .split(CONNECTOR_RE)
    .map((s) => (s ?? '').trim())
    .filter((s) => s.length > 0);
}

export interface SegmentOptions {
  nlu: NluProvider;
  isKnown: (intent: VoiceIntent) => boolean;
  locale?: VoiceLocale;
  minConfidence?: number;
}

/**
 * Segment a compound utterance into ordered intent invocations. Returns them
 * sorted by Intent Priority (stable within equal priority). Unrecognised or
 * non-workflow segments are dropped.
 */
export async function segmentIntents(
  transcript: string,
  opts: SegmentOptions,
): Promise<IntentInvocation[]> {
  const locale = opts.locale ?? 'ar';
  const min = opts.minConfidence ?? 0.4;
  const segments = splitSegments(transcript);

  const invocations: IntentInvocation[] = [];
  for (const segment of segments) {
    const nlu = await opts.nlu.interpret(segment, { locale });
    if (
      nlu.intent !== VoiceIntent.UNKNOWN &&
      nlu.confidence >= min &&
      opts.isKnown(nlu.intent) &&
      INTENT_PRIORITY[nlu.intent] !== undefined
    ) {
      invocations.push({
        intent: nlu.intent,
        bag: nlu.entityBag,
        transcript: segment,
        confidence: nlu.confidence,
      });
    }
  }

  return invocations
    .map((inv, index) => ({ inv, index }))
    .sort((a, b) => {
      const pa = INTENT_PRIORITY[a.inv.intent] ?? 99;
      const pb = INTENT_PRIORITY[b.inv.intent] ?? 99;
      return pa - pb || a.index - b.index; // stable within equal priority
    })
    .map((x) => x.inv);
}
