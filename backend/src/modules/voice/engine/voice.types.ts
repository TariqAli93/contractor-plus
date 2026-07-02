// ============================================================
// Orchestration contracts for the voice dialog engine.
//
// These types define the seams between the engine's modules (registry,
// workflow, confirmation, permission, executor) and the per-intent HANDLERS.
// A handler is the ONLY thing you write to add a command — everything else is
// generic. (Open/Closed + Dependency Inversion.)
// ============================================================

import type { Prisma } from '@prisma/client';
import type {
  ClientAction,
  ConfirmationView,
  CreatedEntityRef,
  EntityBag,
  VoiceIntent,
} from '@contractor-plus/shared';
import type { AuditActor, AuditService } from '../../audit/audit.service.js';

/** Who is driving the turn — used for permission decisions. */
export interface VoicePrincipal {
  userId: string;
  role: string;
  /** Effective permission keys (OWNER is treated as all-allowed regardless). */
  permissions: Set<string>;
}

/** Rolling conversational memory persisted on the VoiceSession. Doubles as the
 *  Shared/Chain Context: after each intent the orchestrator writes the entities
 *  it produced here (lastProjectId, lastContractId, …) so the next intent — in
 *  the same workflow OR a later standalone turn — can use them without the user
 *  restating them. */
export interface SessionContext {
  lastProjectId?: string;
  lastProjectName?: string;
  lastCustomerId?: string;
  lastCustomerName?: string;
  lastContractId?: string;
  lastContractNumber?: string;
  lastPaymentId?: string;
  /** Slots carried over from previous turns (progressive slot filling). */
  entities?: EntityBag;
}

/** A slot the handler needs before it can build a plan. */
export interface SlotDef {
  name: string;
  /** Returns the slot value from the bag, or undefined when missing. */
  read: (bag: EntityBag) => unknown;
  /** Arabic question to ask when the slot is missing (Smart Suggestion). */
  question: string;
  /**
   * Fill this slot from a BARE follow-up answer (e.g. the user replies "250 ألف"
   * to "ما سعر المتر؟"). Mutates the bag and returns true if it filled the slot.
   * Enables multi-turn slot filling (المرحلة 11/13) without re-stating the intent.
   */
  fillFromAnswer?: (bag: EntityBag, utterance: string) => boolean;
}

/** Input passed to a handler to build its plan. */
export interface PlanInput {
  intent: VoiceIntent;
  bag: EntityBag;
  context: SessionContext;
  actor: AuditActor;
  /** The raw utterance for this turn (used e.g. as a cost description). */
  transcript: string;
}

/** Shared state threaded across steps inside ONE transaction. */
export interface StepExecutionContext {
  tx: Prisma.TransactionClient;
  actor: AuditActor;
  audit: AuditService;
  /** Outputs accumulated from earlier steps (e.g. a created projectId). */
  outputs: Record<string, unknown>;
}

/** Context handed to a Saga compensation (runs in its OWN transaction). */
export interface CompensationContext {
  tx: Prisma.TransactionClient;
  actor: AuditActor;
  audit: AuditService;
}

export interface StepResult {
  createdEntities?: CreatedEntityRef[];
  outputs?: Record<string, unknown>;
  message?: string;
}

/** One atomic unit of work. All steps of a server plan run in one transaction. */
export interface PlanStep {
  description: string;
  requiredPermissions: string[];
  execute(ctx: StepExecutionContext): Promise<StepResult>;
}

/**
 * A fully-built plan. `server` plans run `steps` transactionally; `client`
 * plans carry only `clientActions` (navigation/UI) and never touch the DB.
 */
export interface Plan {
  intent: VoiceIntent;
  side: 'server' | 'client';
  mutates: boolean;
  summary: ConfirmationView;
  requiredPermissions: string[];
  steps: PlanStep[];
  clientActions?: ClientAction[];
  /** Persisted into session memory after a successful turn. */
  contextPatch?: Partial<SessionContext>;
}

/** The single extension point: implement this + register it to add a command. */
export interface IntentHandler {
  readonly intent: VoiceIntent;
  /** Slots required before planning; the engine clarifies the first missing one. */
  readonly requiredSlots: SlotDef[];
  plan(input: PlanInput): Promise<Plan> | Plan;
  /**
   * One-line description for the CONSOLIDATED multi-intent confirmation
   * (built without running plan(), since later intents depend on earlier
   * results). Optional — defaults to the intent name.
   */
  summarize?(bag: EntityBag, context: SessionContext): string;
  /**
   * Saga compensation: undo a committed intent when a LATER intent in the same
   * workflow fails or the user cancels mid-workflow. `outputs` are the values
   * the step returned (e.g. { projectId }). Runs in its own transaction.
   * Optional — an intent with no side effects (e.g. navigate) omits it.
   */
  compensate?(outputs: Record<string, unknown>, ctx: CompensationContext): Promise<void>;
}

/** Result of the planning phase (slot-fill gate → plan, or a clarify question). */
export type PlanningOutcome =
  | { kind: 'clarify'; missingSlots: string[]; question: string }
  | { kind: 'plan'; plan: Plan };
