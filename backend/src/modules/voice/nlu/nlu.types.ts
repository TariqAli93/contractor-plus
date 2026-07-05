// ============================================================
// NLU contracts — the seam that makes the AI provider swappable.
//
// `NluProvider` is a PORT (hexagonal architecture). Today the adapter is a
// rule-based Arabic matcher (no network, deterministic, unit-testable). Tomorrow
// an `LlmNluProvider` (Claude / Whisper-derived text → structured intent) can be
// dropped in by implementing this same interface — no other module changes.
// ============================================================

import type {
  EntityBag,
  ExtractedEntity,
  VoiceIntent,
  VoiceLocale,
} from '@contractor-plus/shared';

/** Conversational context the provider may use to bias interpretation. */
export interface NluContext {
  locale: VoiceLocale;
  /** Entities remembered from earlier turns (pronoun/slot carry-over). */
  priorEntities?: EntityBag;
}

export interface NluResult {
  intent: VoiceIntent;
  /** 0..1 — drives the low-confidence rejection / re-confirm policy. */
  confidence: number;
  entities: ExtractedEntity[];
  /** Same entities folded into a typed bag for handler convenience. */
  entityBag: EntityBag;
  /** Normalised transcript (for audit/debug). */
  normalized: string;
  /** Identifier of the adapter that produced this result. */
  provider: string;
  /** Optional ranked alternatives, best-first (excluding the chosen intent). */
  alternatives?: Array<{ intent: VoiceIntent; confidence: number }>;
}

/** The swappable AI/NLP boundary. Implementations MUST be stateless. */
export interface NluProvider {
  readonly name: string;
  interpret(transcript: string, context: NluContext): Promise<NluResult>;
}
