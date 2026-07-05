// ============================================================
// Voice turn protocol — the wire contract between the frontend
// assistant and the backend dialog engine. A "turn" is one exchange.
//
// The conversation is a small state machine driven entirely by the
// discriminated `VoiceTurnResponse`. The frontend never decides policy
// (what is allowed, what needs confirming) — it only renders whichever
// branch the backend returns and collects the next utterance/decision.
// ============================================================

import type { VoiceIntent } from './intents.js';
import type { ExtractedEntity } from './entities.js';

export type VoiceLocale = 'ar' | 'en';

/** Turn 1..n: the user said something. */
export interface InterpretRequest {
  /** Continues an existing voice session; omit to open a new one. */
  sessionId?: string;
  /** Raw transcript from the speech-to-text layer (already text). */
  transcript: string;
  locale?: VoiceLocale;
}

/** Turn after a `confirm` response: the user answered the confirmation. */
export interface DecisionRequest {
  sessionId: string;
  planId: string;
  decision: 'confirm' | 'cancel';
}

// ---------- response branches ----------

export type VoiceTurnResponse =
  | ClarifyResponse
  | ConfirmResponse
  | ExecutedResponse
  | RejectedResponse;

/** Engine understood the intent but needs a missing slot before it can plan. */
export interface ClarifyResponse {
  kind: 'clarify';
  sessionId: string;
  intent: VoiceIntent;
  /** Human question to speak/show, e.g. "ما هي مساحة البيت؟". */
  question: string;
  /** Machine names of the slots still required. */
  missingSlots: string[];
}

/** A mutating plan is ready and awaits the user's explicit yes/no. */
export interface ConfirmResponse {
  kind: 'confirm';
  sessionId: string;
  planId: string;
  intent: VoiceIntent;
  summary: ConfirmationView;
  /** Permission keys this plan will exercise (for transparency/UI). */
  requiredPermissions: string[];
}

/** Work was carried out (or a client action resolved) — terminal for this turn. */
export interface ExecutedResponse {
  kind: 'executed';
  sessionId: string;
  intent: VoiceIntent;
  result: ExecutionView;
  /** UI follow-ups for the client to perform (navigation, toast, …). */
  clientActions: ClientAction[];
}

/** The turn could not proceed. */
export interface RejectedResponse {
  kind: 'rejected';
  sessionId: string;
  reason: 'permission_denied' | 'invalid' | 'unknown_intent' | 'low_confidence' | 'expired';
  message: string;
  missingPermissions?: string[];
}

// ---------- view models ----------

export interface ConfirmationLine {
  label: string;
  value: string;
  icon?: string;
}

export interface ConfirmationView {
  title: string;
  lines: ConfirmationLine[];
  /** True when the plan writes to the database (vs. a read/navigate plan). */
  mutates: boolean;
}

export interface CreatedEntityRef {
  type: string; // 'Project' | 'Contract' | ...
  id: string;
  label: string;
}

export interface ExecutionView {
  message: string;
  createdEntities: CreatedEntityRef[];
}

export type ClientAction =
  | { type: 'navigate'; to: string }
  | { type: 'open_palette'; query?: string }
  | { type: 'toast'; level: 'success' | 'info' | 'error'; message: string };

// ---------- diagnostics (optional, attached for the audit/debug view) ----------

export interface NluDiagnostics {
  intent: VoiceIntent;
  confidence: number;
  entities: ExtractedEntity[];
  normalizedTranscript: string;
  provider: string;
}
