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
