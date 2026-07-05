// Module-level types for the voice feature (HTTP/orchestration layer).

import type { EntityBag, VoiceIntent } from '@contractor-plus/shared';
import type { AuditActor } from '../audit/audit.service.js';
import type { SessionContext } from './engine/voice.types.js';

/** Identity + audit metadata for one voice turn. */
export interface VoiceActor extends AuditActor {
  role: string;
}

/** A confirmation that is pending the user's yes/no. Re-built on confirm — we
 *  never persist executable closures, only the data needed to recreate the plan. */
export interface PendingTurn {
  planId: string;
  intent: VoiceIntent;
  bag: EntityBag;
  transcript: string;
}

/** An intent waiting for the user to answer a clarify question. The next bare
 *  utterance ("200", "250 ألف", "أحمد") is folded into this intent's slots. */
export interface PendingClarification {
  intent: VoiceIntent;
  bag: EntityBag;
  awaitingSlot: string;
}

/** One step of a compound workflow (an intent + its extracted slots). */
export interface WorkflowInvocation {
  intent: VoiceIntent;
  bag: EntityBag;
  transcript: string;
}

/** A workflow step that already committed — kept for Saga compensation. */
export interface CompletedStep {
  intent: VoiceIntent;
  outputs: Record<string, unknown>;
}

/**
 * A multi-intent workflow in flight (persisted so it survives the HTTP turns of
 * clarification/confirmation). The Saga state: what's done (for compensation),
 * what remains, and the evolving shared chain context.
 */
export interface PendingWorkflow {
  planId: string;
  phase: 'awaiting_confirmation' | 'awaiting_clarification';
  /** True once execution has begun (after the consolidated confirmation). */
  started: boolean;
  pending: WorkflowInvocation[];
  completed: CompletedStep[];
  chain: SessionContext;
  awaitingIndex?: number;
  awaitingSlot?: string;
}

/** What we actually store in the VoiceSession.context JSON column. */
export interface StoredSessionContext extends SessionContext {
  pendingTurn?: PendingTurn;
  pendingClarification?: PendingClarification;
  pendingWorkflow?: PendingWorkflow;
}
