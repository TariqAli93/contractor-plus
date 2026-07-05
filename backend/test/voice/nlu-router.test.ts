import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceIntent } from '@contractor-plus/shared';
import {
  classifyNluResult,
  LLM_ACCEPT_CONFIDENCE,
  RULE_ACCEPT_CONFIDENCE,
  type NluResultSignal,
} from '../../src/modules/voice/nlu/nlu-provider-router.js';

// Base signal: a known LLM intent with a high score and nothing missing.
function sig(overrides: Partial<NluResultSignal> = {}): NluResultSignal {
  return {
    intent: VoiceIntent.ADD_PAYMENT,
    confidence: 0.9,
    known: true,
    llmUsed: true,
    missingFields: [],
    clarificationQuestion: null,
    ...overrides,
  };
}

// ---- the three required cases ---------------------------------------------

test('LLM intent at 0.45 (>= 0.3) with a valid intent → accepted', () => {
  assert.equal(classifyNluResult(sig({ confidence: 0.45 })).kind, 'accepted');
});

test('LLM intent at 0.2 (< 0.3), nothing missing → low_confidence', () => {
  assert.equal(classifyNluResult(sig({ confidence: 0.2 })).kind, 'low_confidence');
});

test('LLM missingFields + clarificationQuestion → needs_clarification (never low_confidence)', () => {
  const r = classifyNluResult(
    sig({ confidence: 0.2, missingFields: ['money'], clarificationQuestion: 'كم المبلغ؟' }),
  );
  assert.equal(r.kind, 'needs_clarification');
  if (r.kind === 'needs_clarification') assert.equal(r.question, 'كم المبلغ؟');
});

// ---- surrounding behavior --------------------------------------------------

test('empty/unknown intent → unrecognized (distinct from low_confidence)', () => {
  assert.equal(classifyNluResult(sig({ intent: VoiceIntent.UNKNOWN })).kind, 'unrecognized');
  // A confident score cannot rescue an intent the registry cannot execute.
  assert.equal(classifyNluResult(sig({ known: false, confidence: 0.99 })).kind, 'unrecognized');
});

test('VOICE_LLM_MIN_CONFIDENCE-style escalation floor is NOT the acceptance floor', () => {
  // 0.35 clears the LLM acceptance floor (0.3) but not the RuleBased one (0.4).
  assert.equal(classifyNluResult(sig({ llmUsed: true, confidence: 0.35 })).kind, 'accepted');
  assert.equal(classifyNluResult(sig({ llmUsed: false, confidence: 0.35 })).kind, 'low_confidence');
  assert.ok(LLM_ACCEPT_CONFIDENCE < RULE_ACCEPT_CONFIDENCE);
});

test('missingFields without a question falls through to the confidence floor', () => {
  // No question to show → not a clarification; a good score is still accepted.
  assert.equal(
    classifyNluResult(sig({ confidence: 0.5, missingFields: ['money'], clarificationQuestion: null }))
      .kind,
    'accepted',
  );
});

test('missingFields override beats a sub-floor score (understood-but-incomplete asks)', () => {
  // The key fix: a low score with an itemised gap asks instead of rejecting.
  assert.equal(
    classifyNluResult(
      sig({ confidence: 0.1, missingFields: ['money'], clarificationQuestion: 'كم المبلغ؟' }),
    ).kind,
    'needs_clarification',
  );
});
