// ============================================================
// NluProviderRouter — decides RuleBased vs LLM for a turn.
//
// RuleBased is the default and the permanent Offline/Fallback. The LLM is only
// engaged when RuleBased is uncertain or the utterance is hard:
//   • intent UNKNOWN
//   • low confidence (dialect / messy speech)
//   • long utterance that RuleBased didn't split but might be multi-intent
// High-confidence simple commands never touch the LLM (fast + free + offline).
// ============================================================

import { VoiceIntent } from '@contractor-plus/shared';
import type { NluResult } from './nlu.types.js';
import type { IntentInvocation } from '../engine/compound-segmenter.js';

export interface RouteDecision {
  useLlm: boolean;
  reason: string;
}

export class NluProviderRouter {
  constructor(
    private readonly minConfidence: number,
    private readonly llmAvailable: boolean,
  ) {}

  decide(ruleNlu: NluResult, ruleSegments: IntentInvocation[], transcript: string): RouteDecision {
    if (!this.llmAvailable) return { useLlm: false, reason: 'llm_disabled' };
    if (ruleNlu.intent === VoiceIntent.UNKNOWN) return { useLlm: true, reason: 'unknown_intent' };
    if (ruleNlu.confidence < this.minConfidence) return { useLlm: true, reason: 'low_confidence' };

    const tokenCount = transcript.trim().split(/\s+/).filter(Boolean).length;
    if (ruleSegments.length < 2 && tokenCount >= 10) {
      return { useLlm: true, reason: 'long_possibly_compound' };
    }
    return { useLlm: false, reason: 'rule_sufficient' };
  }
}

// ===========================================================================
// Acceptance of an NLU result — SEPARATE from escalation.
//
// The escalation threshold above (minConfidence / VOICE_LLM_MIN_CONFIDENCE) only
// decides RuleBased→LLM. It must NEVER be used to reject a valid LLM result:
// once the LLM has natively classified a KNOWN intent, a modest confidence is
// enough to act on. So acceptance uses its OWN floors — and a lower one for the
// LLM, which already did the hard classification.
// ===========================================================================

/** A valid, known LLM intent is accepted from this confidence up. */
export const LLM_ACCEPT_CONFIDENCE = 0.3;
/** RuleBased needs a little more certainty (it can misfire on noisy speech). */
export const RULE_ACCEPT_CONFIDENCE = 0.4;

export type NluAcceptance =
  | { kind: 'accepted' }
  | { kind: 'needs_clarification'; question: string }
  | { kind: 'low_confidence' }
  | { kind: 'unrecognized' };

export interface NluResultSignal {
  intent: VoiceIntent;
  confidence: number;
  /** Is `intent` a handler the registry can actually execute? */
  known: boolean;
  /** Did this result come from the LLM (vs RuleBased)? */
  llmUsed: boolean;
  /** Fields the LLM flagged as missing (empty for RuleBased). */
  missingFields: string[];
  /** The LLM's one-line question when something is missing, else null. */
  clarificationQuestion: string | null;
}

/**
 * Decide what to DO with an NLU result on a FRESH turn (no pending clarification):
 *   1. no usable intent (UNKNOWN, or unknown to the registry) → `unrecognized`
 *   2. the LLM understood the intent but itemised missing fields → ask, never
 *      reject — even below the confidence floor (a understood-but-incomplete
 *      command is a clarification, not a failure)
 *   3. below the provider's acceptance floor → `low_confidence`
 *   4. otherwise → `accepted`
 *
 * VOICE_LLM_MIN_CONFIDENCE is intentionally NOT referenced here.
 */
export function classifyNluResult(r: NluResultSignal): NluAcceptance {
  if (r.intent === VoiceIntent.UNKNOWN || !r.known) return { kind: 'unrecognized' };

  if (r.llmUsed && r.missingFields.length > 0 && r.clarificationQuestion) {
    return { kind: 'needs_clarification', question: r.clarificationQuestion };
  }

  const floor = r.llmUsed ? LLM_ACCEPT_CONFIDENCE : RULE_ACCEPT_CONFIDENCE;
  if (r.confidence < floor) return { kind: 'low_confidence' };

  return { kind: 'accepted' };
}
