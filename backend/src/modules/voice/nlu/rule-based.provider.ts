// ============================================================
// Rule-based Arabic NLU provider — the default adapter for the NluProvider port.
//
// Deterministic, offline, unit-testable. It does NOT string-match whole
// sentences: it scores each intent by how many of its lexical cues (verbs,
// nouns, boosters, phrases) appear in the normalised utterance, then picks the
// best. New phrasings are absorbed by editing the lexicon (data), not this file.
//
// Compound commands ("...وسوي عقد...وضيف المواد...") resolve to a single PRIMARY
// intent here; the matching IntentHandler's WorkflowEngine expands the extra
// cues (customer name, auto-materials) into sub-steps.
// ============================================================

import { VoiceIntent, type EntityBag } from '@contractor-plus/shared';
import { INTENT_LEXICON } from './arabic-lexicon.js';
import { extractEntities } from './entity-extractor.js';
import { deWaw, normalizeArabic, tokenize } from './normalize.js';
import type { NluContext, NluProvider, NluResult } from './nlu.types.js';

interface Scored {
  intent: VoiceIntent;
  score: number;
}

function scoreIntent(
  lex: (typeof INTENT_LEXICON)[number],
  normTokens: Set<string>,
  normJoined: string,
): number {
  let score = 0;

  // Standalone phrase => decisive. A single-word phrase must match a WHOLE token
  // (so short words like "لا"/"اي" don't match as substrings of "الإحالة" etc.);
  // multi-word phrases match as a substring of the normalised utterance.
  if (lex.phrases?.some((ph) => (ph.includes(' ') ? normJoined.includes(ph) : normTokens.has(ph)))) {
    score += 3;
  }

  const verbHit = lex.verbs.some((v) => normTokens.has(v));
  const nounHit = lex.nouns.some((n) => normTokens.has(n));

  if (verbHit && nounHit) score += 2;
  else if (nounHit) score += 1;
  else if (verbHit) score += 0.5;

  if (lex.boosters) {
    for (const b of lex.boosters) if (normTokens.has(b)) score += 0.5;
  }
  return score;
}

export class RuleBasedNluProvider implements NluProvider {
  readonly name = 'rule-based-ar';

  async interpret(transcript: string, _context: NluContext): Promise<NluResult> {
    const normalized = normalizeArabic(transcript);
    const tokens = tokenize(transcript);
    // Include the de-waw'd form of each token so a glued "و" (e.g. "وأضف",
    // common after splitting a compound command) still matches the lexicon.
    const normTokens = new Set<string>();
    for (const t of tokens) {
      normTokens.add(t.norm);
      normTokens.add(deWaw(t.norm));
    }
    const normJoined = normalized;

    const scored: Scored[] = INTENT_LEXICON.map((lex) => ({
      intent: lex.intent,
      score: scoreIntent(lex, normTokens, normJoined),
    })).sort((a, b) => b.score - a.score);

    const best = scored[0];
    const { entities, bag } = extractEntities(transcript);

    if (!best || best.score <= 0) {
      return {
        intent: VoiceIntent.UNKNOWN,
        confidence: 0,
        entities,
        entityBag: bag as EntityBag,
        normalized,
        provider: this.name,
        alternatives: [],
      };
    }

    // Map raw score (≈0.5..5) to a 0..1 confidence with a soft ceiling.
    const confidence = Math.max(0, Math.min(1, best.score / 3));

    const alternatives = scored
      .slice(1)
      .filter((s) => s.score > 0)
      .slice(0, 3)
      .map((s) => ({ intent: s.intent, confidence: Math.min(1, s.score / 3) }));

    return {
      intent: best.intent,
      confidence,
      entities,
      entityBag: bag as EntityBag,
      normalized,
      provider: this.name,
      alternatives,
    };
  }
}
