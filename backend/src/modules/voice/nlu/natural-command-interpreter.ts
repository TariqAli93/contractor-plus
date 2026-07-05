// ============================================================
// NaturalCommandInterpreter — the natural-language understanding layer that sits
// ON TOP of the existing engine (it changes nothing below it).
//
// It produces ONLY the same shapes the engine already consumes:
//   • `single`     : an NluResult (single-intent path)
//   • `invocations`: IntentInvocation[] (workflow path)
// So whether the understanding came from RuleBased or the LLM, the downstream
// WorkflowManager / handlers / PermissionEngine / ConfirmationEngine / Executor
// run UNCHANGED. The LLM only ever returns data here; it never executes.
//
// Fallback is total: if the LLM is disabled, unconfigured, times out, errors, or
// yields nothing usable, the RuleBased result is used and the user notices
// nothing. Which provider answered (and why) is returned for the audit log.
// ============================================================

import { type EntityBag, type VoiceIntent, type VoiceLocale } from '@contractor-plus/shared';
import type { NluProvider, NluResult } from './nlu.types.js';
import {
  INTENT_PRIORITY,
  segmentIntents,
  type IntentInvocation,
} from '../engine/compound-segmenter.js';
import type { SessionContext } from '../engine/voice.types.js';
import { NluProviderRouter } from './nlu-provider-router.js';
import type { LlmNluProvider } from './llm/llm-nlu.provider.js';
import { logger } from '../../../lib/logger.js';

export interface Understanding {
  invocations: IntentInvocation[];
  single: NluResult;
  /** Provider that produced the result (for audit): rule-based-ar | llm:anthropic | … */
  provider: string;
  llmUsed: boolean;
  reason: string;
  /** Fields the LLM flagged as missing (empty on the RuleBased paths). */
  missingFields: string[];
  /** The LLM's one-line clarification question when something is missing, else null. */
  clarificationQuestion: string | null;
}

export interface IntentRegistryView {
  has(intent: VoiceIntent): boolean;
}

export class NaturalCommandInterpreter {
  constructor(
    private readonly ruleBased: NluProvider,
    private readonly registry: IntentRegistryView,
    private readonly router: NluProviderRouter,
    private readonly llm: LlmNluProvider | null,
  ) {}

  async understand(
    transcript: string,
    context: SessionContext,
    ruleNlu: NluResult,
    locale: VoiceLocale,
  ): Promise<Understanding> {
    // RuleBased baseline (always computed — it is the fallback).
    const ruleSegments = await segmentIntents(transcript, {
      nlu: this.ruleBased,
      isKnown: (i) => this.registry.has(i),
      locale,
    });

    const decision = this.router.decide(ruleNlu, ruleSegments, transcript);
    if (!decision.useLlm || !this.llm) {
      return {
        invocations: ruleSegments,
        single: ruleNlu,
        provider: ruleNlu.provider,
        llmUsed: false,
        reason: decision.reason,
        missingFields: [],
        clarificationQuestion: null,
      };
    }

    try {
      const li = await this.llm.interpret(transcript, {
        hasLastProject: Boolean(context.lastProjectId),
        hasLastContract: Boolean(context.lastContractId),
        hasLastCustomer: Boolean(context.lastCustomerId),
      });

      console.log('========== LLM ==========');
      console.log(JSON.stringify(li, null, 2));
      console.log('=========================');

      const known = li.intents.filter((i) => this.registry.has(i));

      console.log({
        intents: li.intents,
        known,
        confidence: li.confidence,
        missingFields: li.missingFields,
        clarificationQuestion: li.clarificationQuestion,
      });

      // Safe telemetry — provider + recognised intents + confidence + missing
      // fields ONLY. Never the transcript, the entity values, or the raw output
      // (those can carry customer names / amounts).
      logger.info(
        {
          provider: this.llm.name,
          intents: known,
          confidence: li.confidence,
          missingFields: li.missingFields,
        },
        '[voice-nlu] llm understanding',
      );

      if (known.length === 0) {
        // Nothing usable — keep RuleBased rather than reject.
        return {
          invocations: ruleSegments,
          single: ruleNlu,
          provider: 'rule-based:llm-empty',
          llmUsed: false,
          reason: 'llm_no_usable_intent',
          missingFields: [],
          clarificationQuestion: null,
        };
      }

      const invocations = this.toInvocations(known, li.entityBag, transcript);
      const single: NluResult = {
        intent: known[0]!,
        confidence: li.confidence,
        entities: [],
        entityBag: li.entityBag,
        normalized: li.normalizedCommand,
        provider: this.llm.name,
        alternatives: known.slice(1).map((i) => ({ intent: i, confidence: li.confidence })),
      };

      return {
        invocations,
        single,
        provider: this.llm.name,
        llmUsed: true,
        reason: decision.reason,
        missingFields: li.missingFields,
        clarificationQuestion: li.clarificationQuestion,
      };
    } catch (err) {
      // Total fallback — the user never sees a failure.
      const msg = err instanceof Error ? err.message : 'llm_error';
      return {
        invocations: ruleSegments,
        single: ruleNlu,
        provider: 'rule-based:llm-fallback',
        llmUsed: false,
        reason: `llm_failed:${msg}`,
        missingFields: [],
        clarificationQuestion: null,
      };
    }
  }

  /** LLM intents → priority-ordered invocations sharing the merged entity bag. */
  private toInvocations(
    intents: VoiceIntent[],
    bag: EntityBag,
    transcript: string,
  ): IntentInvocation[] {
    return intents
      .filter((intent) => INTENT_PRIORITY[intent] !== undefined)
      .map((intent, index) => ({ intent, index }))
      .sort((a, b) => {
        const pa = INTENT_PRIORITY[a.intent] ?? 99;
        const pb = INTENT_PRIORITY[b.intent] ?? 99;
        return pa - pb || a.index - b.index;
      })
      .map((x) => ({ intent: x.intent, bag: { ...bag }, transcript, confidence: 1 }));
  }
}
