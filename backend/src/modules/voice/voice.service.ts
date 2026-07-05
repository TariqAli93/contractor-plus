// ============================================================
// Voice dialog orchestrator.
//
// Sequences the pipeline for one turn:
//   STT(text) → NLU → Context → Workflow(slot-fill) → Permission →
//   Confirmation → Execution → Audit/Persist
//
// It owns NO domain logic and NO recognition logic — it composes the engine
// modules and the swappable NluProvider. This is the application service in
// Clean-Architecture terms: thin, declarative, fully unit-testable with fakes.
// ============================================================

import { randomUUID } from 'node:crypto';
import {
  VoiceIntent,
  isServerIntent,
  type ClarifyResponse,
  type ConfirmResponse,
  type EntityBag,
  type ExecutedResponse,
  type RejectedResponse,
  type VoiceLocale,
  type VoiceTurnResponse,
} from '@contractor-plus/shared';
import { VoiceCommandStatus, type PrismaClient } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { AccessService } from '../rbac/access.service.js';
import { NotFoundError } from '../../shared/errors/not-found.error.js';
import { ContextManager } from './engine/context-manager.js';
import { ConfirmationEngine } from './engine/confirmation-engine.js';
import { Executor } from './engine/executor.js';
import { PermissionEngine } from './engine/permission-engine.js';
import { WorkflowEngine } from './engine/workflow-engine.js';
import { WorkflowManager, type WorkflowOutcome } from './engine/workflow-manager.js';
import type { IntentInvocation } from './engine/compound-segmenter.js';
import { buildIntentRegistry } from './engine/intents/index.js';
import type { IntentRegistry } from './engine/intent-registry.js';
import type { Plan, VoicePrincipal } from './engine/voice.types.js';
import type { NluProvider, NluResult } from './nlu/nlu.types.js';
import { RuleBasedNluProvider } from './nlu/rule-based.provider.js';
import { NaturalCommandInterpreter } from './nlu/natural-command-interpreter.js';
import { NluProviderRouter, classifyNluResult } from './nlu/nlu-provider-router.js';
import { createLlmClient } from './nlu/llm/llm-client.js';
import { LlmNluProvider } from './nlu/llm/llm-nlu.provider.js';
import { VoiceLlmStore } from './nlu/llm/voice-llm.store.js';
import { sha256 } from '../../lib/crypto.js';
import { VoiceRepository } from './voice.repository.js';
import type { PendingWorkflow, StoredSessionContext, VoiceActor } from './voice.types.js';

/** Outcome of resolving a turn's intent+bag. A reject carries the wire reason. */
type ResolvedTurn =
  | { ok: true; intent: VoiceIntent; bag: EntityBag }
  | { ok: false; reason: 'low_confidence' | 'unknown_intent' };

/** The LLM's signal for a fresh turn, forwarded from the interpreter to acceptance. */
interface LlmSignal {
  llmUsed: boolean;
  missingFields: string[];
  clarificationQuestion: string | null;
}

export interface VoiceServiceDeps {
  nlu?: NluProvider;
  registry?: IntentRegistry;
}

export class VoiceService {
  private readonly repo: VoiceRepository;
  private readonly audit: AuditService;
  private readonly access: AccessService;
  private readonly nlu: NluProvider;
  private readonly registry: IntentRegistry;
  private readonly context = new ContextManager();
  private readonly workflow = new WorkflowEngine();
  private readonly confirmation = new ConfirmationEngine();
  private readonly permission = new PermissionEngine();
  private readonly executor: Executor;
  private readonly workflowMgr: WorkflowManager;
  private readonly llmStore: VoiceLlmStore;
  /** Memoised understanding layer; rebuilt only when the resolved LLM config changes. */
  private llmMemo?: { sig: string; interpreter: NaturalCommandInterpreter };

  constructor(private readonly prisma: PrismaClient, deps: VoiceServiceDeps = {}) {
    this.repo = new VoiceRepository(prisma);
    this.audit = new AuditService(prisma);
    this.access = new AccessService(prisma);
    this.executor = new Executor(prisma, this.audit);
    // RuleBasedNluProvider is the permanent base + Offline/Fallback.
    this.nlu = deps.nlu ?? new RuleBasedNluProvider();
    this.registry = deps.registry ?? buildIntentRegistry(prisma);
    this.workflowMgr = new WorkflowManager(
      prisma,
      this.audit,
      this.registry,
      this.workflow,
      this.permission,
      this.executor,
    );
    this.llmStore = new VoiceLlmStore(prisma);
  }

  /**
   * Build (or reuse) the natural-language understanding layer from the CURRENT
   * settings (DB over .env). Resolved per turn so enable/disable/key changes take
   * effect with no restart; memoised by config signature so an unchanged config
   * doesn't rebuild the HTTP client every turn. LLM disabled / no key → null
   * provider → RuleBased only.
   */
  private async getInterpreter(): Promise<NaturalCommandInterpreter> {
    const cfg = await this.llmStore.resolve();
    const sig = JSON.stringify({
      enabled: cfg.enabled,
      provider: cfg.provider,
      model: cfg.model,
      timeoutMs: cfg.timeoutMs,
      maxTokens: cfg.maxTokens,
      minConfidence: cfg.minConfidence,
      keyHash: cfg.apiKey ? sha256(cfg.apiKey) : null,
    });
    if (this.llmMemo?.sig === sig) return this.llmMemo.interpreter;

    const client = createLlmClient(cfg);
    const llm = client ? new LlmNluProvider(client) : null;
    const router = new NluProviderRouter(cfg.minConfidence, llm !== null);
    const interpreter = new NaturalCommandInterpreter(this.nlu, this.registry, router, llm);
    this.llmMemo = { sig, interpreter };
    return interpreter;
  }

  // ---------- Turn 1..n: an utterance ----------

  async interpret(
    actor: VoiceActor,
    input: { sessionId?: string; transcript: string; locale?: VoiceLocale },
  ): Promise<VoiceTurnResponse> {
    const locale: VoiceLocale = input.locale ?? 'ar';
    const { id: sessionId, context } = await this.loadOrOpenSession(actor, input.sessionId, locale);

    const nlu = await this.nlu.interpret(input.transcript, {
      locale,
      priorEntities: context.entities,
    });

    // 0) An in-flight multi-intent workflow takes precedence over everything.
    if (context.pendingWorkflow) {
      const handled = await this.handleWorkflowTurn(
        actor,
        sessionId,
        context,
        nlu,
        input.transcript,
      );
      if (handled) return handled;
      // null → the user abandoned the workflow; continue as a fresh turn.
      context.pendingWorkflow = undefined;
    }

    // Meta intents short-circuit the pipeline (work even mid-clarification).
    if (nlu.intent === VoiceIntent.CANCEL) {
      return this.cancelPending(actor, sessionId, context, input.transcript);
    }
    if (nlu.intent === VoiceIntent.HELP) {
      return this.help(actor, sessionId, input.transcript, nlu);
    }
    if (nlu.intent === VoiceIntent.CONFIRM) {
      if (context.pendingTurn) return this.runPending(actor, sessionId, context);
      return this.executedText(sessionId, VoiceIntent.CONFIRM, 'لا يوجد أمر بانتظار التأكيد.');
    }

    // 1) Natural-language understanding. RuleBased by default; the router
    //    escalates hard/messy/dialect/compound utterances to the LLM, with TOTAL
    //    fallback to RuleBased. Skipped during a clarification answer (the next
    //    utterance is a bare value the RuleBased extractor handles). The output
    //    is the SAME shape the engine already consumes — nothing below changes.
    let workingNlu = nlu;
    let llmSignal: LlmSignal | undefined;
    if (!context.pendingClarification) {
      const interpreter = await this.getInterpreter();
      const understanding = await interpreter.understand(input.transcript, context, nlu, locale);
      if (understanding.invocations.length >= 2) {
        return this.startWorkflow(
          actor,
          sessionId,
          context,
          understanding.invocations,
          input.transcript,
          understanding.provider,
        );
      }
      workingNlu = understanding.single;
      llmSignal = {
        llmUsed: understanding.llmUsed,
        missingFields: understanding.missingFields,
        clarificationQuestion: understanding.clarificationQuestion,
      };
    }

    // Resolve the working intent + bag, honouring an in-flight clarification:
    // a bare answer ("200", "250 ألف", "أحمد") is folded into the pending intent.
    // For a fresh turn, acceptance is provider-aware (see resolveTurn): a valid
    // LLM intent is NOT rejected merely for a sub-0.4 score, and an unrecognised
    // command is distinguished from a low-confidence one.
    const resolution = this.resolveTurn(workingNlu, context, input.transcript, llmSignal);
    if (!resolution.ok) {
      return this.rejectTurn(actor, sessionId, input.transcript, workingNlu, {
        reason: resolution.reason,
        message:
          resolution.reason === 'unknown_intent'
            ? 'ما فهمت شنو تريد تسوّي بالضبط. جرّب تحدّد الأمر أكثر — مثلاً: «سوي مشروع بيت» أو «سجّل دفعة مليون».'
            : 'لم أفهم الطلب بوضوح. ممكن تعيد الأمر بصيغة أخرى؟',
      });
    }
    const { intent: workingIntent, bag: effectiveBag } = resolution;

    const handler = this.registry.get(workingIntent);
    if (!handler) {
      return this.rejectTurn(actor, sessionId, input.transcript, workingNlu, {
        reason: 'invalid',
        message: 'هذا الأمر غير مدعوم حالياً.',
      });
    }

    const outcome = await this.workflow.buildPlan(
      handler,
      effectiveBag,
      context,
      actor,
      input.transcript,
    );
    const remembered = this.context.remember(context, effectiveBag);

    if (outcome.kind === 'clarify') {
      const next: StoredSessionContext = {
        ...remembered,
        pendingTurn: undefined,
        pendingClarification: {
          intent: workingIntent,
          bag: effectiveBag,
          awaitingSlot: outcome.missingSlots[0] ?? '',
        },
      };
      await this.repo.updateContext(sessionId, next);
      await this.repo.logCommand({
        sessionId,
        userId: actor.userId,
        transcript: input.transcript,
        normalized: workingNlu.normalized,
        intent: workingIntent,
        confidence: workingNlu.confidence,
        entities: workingNlu.entities,
        status: VoiceCommandStatus.CLARIFYING,
        resultMessage: outcome.question,
        provider: workingNlu.provider,
      });
      const res: ClarifyResponse = {
        kind: 'clarify',
        sessionId,
        intent: workingIntent,
        question: outcome.question,
        missingSlots: outcome.missingSlots,
      };
      return res;
    }

    const plan = outcome.plan;
    // Clarification satisfied — drop it from memory.
    const cleared: StoredSessionContext = { ...remembered, pendingClarification: undefined };

    const principal = await this.principal(actor);
    const verdict = this.permission.evaluate(plan, principal);
    if (!verdict.allowed) {
      await this.repo.updateContext(sessionId, cleared);
      return this.rejectTurn(actor, sessionId, input.transcript, workingNlu, {
        reason: 'permission_denied',
        message: 'ليس لديك صلاحية تنفيذ هذا الأمر.',
        missingPermissions: verdict.missing,
      });
    }

    // Mutating → must be confirmed first.
    if (this.confirmation.requiresConfirmation(plan)) {
      const planId = randomUUID();
      const pending: StoredSessionContext = {
        ...cleared,
        pendingTurn: { planId, intent: workingIntent, bag: effectiveBag, transcript: input.transcript },
      };
      await this.repo.updateContext(sessionId, pending);
      await this.repo.logCommand({
        sessionId,
        userId: actor.userId,
        transcript: input.transcript,
        normalized: workingNlu.normalized,
        intent: workingIntent,
        confidence: workingNlu.confidence,
        entities: workingNlu.entities,
        plan: this.planSnapshot(plan),
        status: VoiceCommandStatus.AWAITING_CONFIRMATION,
        provider: workingNlu.provider,
      });
      const res: ConfirmResponse = {
        kind: 'confirm',
        sessionId,
        planId,
        intent: workingIntent,
        summary: plan.summary,
        requiredPermissions: this.allPerms(plan),
      };
      return res;
    }

    // Non-mutating (navigation / read) → run immediately.
    return this.runPlan(actor, sessionId, plan, cleared, {
      transcript: input.transcript,
      normalized: workingNlu.normalized,
      intent: workingIntent,
      confidence: workingNlu.confidence,
      entities: workingNlu.entities,
      provider: workingNlu.provider,
    });
  }

  /**
   * Pick the intent + entity bag for this turn. If a clarification is pending and
   * the utterance is NOT a confident, different new intent, treat it as the
   * answer: merge fresh entities into the pending bag and try the awaited slot's
   * bare-answer filler. Returns null only when there is nothing to act on.
   */
  private resolveTurn(
    nlu: { intent: VoiceIntent; confidence: number; entityBag: EntityBag },
    context: StoredSessionContext,
    transcript: string,
    llmSignal?: LlmSignal,
  ): ResolvedTurn {
    const pending = context.pendingClarification;

    if (pending) {
      const startsNew =
        nlu.confidence >= 0.7 && this.registry.has(nlu.intent) && nlu.intent !== pending.intent;
      if (!startsNew) {
        const merged: EntityBag = { ...pending.bag, ...stripUndefined(nlu.entityBag) };
        const handler = this.registry.get(pending.intent);
        const slot = handler?.requiredSlots.find((s) => s.name === pending.awaitingSlot);
        const current = slot?.read(merged);
        if (slot?.fillFromAnswer && (current === undefined || current === null || current === '')) {
          slot.fillFromAnswer(merged, transcript);
        }
        return { ok: true, intent: pending.intent, bag: this.context.resolve(merged, context) };
      }
    }

    // Fresh turn: provider-aware acceptance. The LLM's floor (0.3) is lower than
    // RuleBased's (0.4) — a natively-classified intent isn't discarded for a
    // modest score — and an LLM-flagged missing field routes to clarification,
    // not rejection. VOICE_LLM_MIN_CONFIDENCE plays no part here (escalation only).
    const acceptance = classifyNluResult({
      intent: nlu.intent,
      confidence: nlu.confidence,
      known: this.registry.has(nlu.intent),
      llmUsed: llmSignal?.llmUsed ?? false,
      missingFields: llmSignal?.missingFields ?? [],
      clarificationQuestion: llmSignal?.clarificationQuestion ?? null,
    });

    switch (acceptance.kind) {
      case 'accepted':
      case 'needs_clarification':
        // Both proceed — when a required field is genuinely missing the handler
        // emits the authoritative clarify (with a real awaiting-slot to fold the
        // next bare answer into), which is richer than the LLM's own question.
        return { ok: true, intent: nlu.intent, bag: this.context.resolve(nlu.entityBag, context) };
      case 'unrecognized':
        return { ok: false, reason: 'unknown_intent' };
      case 'low_confidence':
        return { ok: false, reason: 'low_confidence' };
    }
  }

  // ---------- Turn after a confirm: the decision ----------

  async decide(
    actor: VoiceActor,
    input: { sessionId: string; planId: string; decision: 'confirm' | 'cancel' },
  ): Promise<VoiceTurnResponse> {
    const session = await this.repo.findSession(input.sessionId, actor.userId);
    if (!session) throw new NotFoundError('Voice session', 'VOICE_SESSION_NOT_FOUND');
    const context = (session.context ?? {}) as StoredSessionContext;

    // A multi-intent workflow awaiting confirmation.
    if (context.pendingWorkflow && context.pendingWorkflow.planId === input.planId) {
      if (input.decision === 'cancel') {
        await this.repo.updateContext(session.id, { ...context, pendingWorkflow: undefined });
        await this.repo.logCommand({
          sessionId: session.id,
          userId: actor.userId,
          transcript: '',
          intent: 'workflow',
          confidence: 1,
          status: VoiceCommandStatus.CANCELLED,
          resultMessage: 'أُلغيت السلسلة.',
          provider: 'workflow',
        });
        return this.executedText(session.id, VoiceIntent.CANCEL, 'تم إلغاء السلسلة.');
      }
      const principal = await this.principal(actor);
      const outcome = await this.workflowMgr.run(context.pendingWorkflow, principal, actor);
      return this.applyWorkflowOutcome(actor, session.id, context, context.pendingWorkflow, outcome, '');
    }

    if (!context.pendingTurn || context.pendingTurn.planId !== input.planId) {
      const res: RejectedResponse = {
        kind: 'rejected',
        sessionId: session.id,
        reason: 'expired',
        message: 'انتهت صلاحية هذا التأكيد. أعد المحاولة من جديد.',
      };
      return res;
    }

    if (input.decision === 'cancel') {
      return this.cancelPending(actor, session.id, context, context.pendingTurn.transcript);
    }
    return this.runPending(actor, session.id, context);
  }

  // ---------- multi-intent workflow ----------

  /** Route a turn that arrives while a workflow is in flight. Returns null when
   *  the user clearly abandoned it (so the caller processes a fresh command). */
  private async handleWorkflowTurn(
    actor: VoiceActor,
    sessionId: string,
    context: StoredSessionContext,
    nlu: NluResult,
    transcript: string,
  ): Promise<VoiceTurnResponse | null> {
    const wf = context.pendingWorkflow!;

    if (nlu.intent === VoiceIntent.CANCEL) {
      await this.repo.updateContext(sessionId, { ...context, pendingWorkflow: undefined });
      await this.repo.logCommand({
        sessionId,
        userId: actor.userId,
        transcript,
        intent: 'workflow',
        confidence: 1,
        status: VoiceCommandStatus.CANCELLED,
        resultMessage: 'أُلغيت السلسلة.',
        provider: 'workflow',
      });
      return this.executedText(sessionId, VoiceIntent.CANCEL, 'تم إلغاء السلسلة.');
    }

    if (wf.phase === 'awaiting_clarification') {
      const outcome = this.workflowMgr.answer(wf, nlu.entityBag, transcript, actor);
      return this.applyWorkflowOutcome(actor, sessionId, context, wf, outcome, transcript);
    }

    if (wf.phase === 'awaiting_confirmation' && nlu.intent === VoiceIntent.CONFIRM) {
      const principal = await this.principal(actor);
      const outcome = await this.workflowMgr.run(wf, principal, actor);
      return this.applyWorkflowOutcome(actor, sessionId, context, wf, outcome, transcript);
    }

    return null; // abandon → caller continues with a fresh command
  }

  private async startWorkflow(
    actor: VoiceActor,
    sessionId: string,
    context: StoredSessionContext,
    invocations: IntentInvocation[],
    transcript: string,
    provider = 'workflow',
  ): Promise<VoiceTurnResponse> {
    const { workflow, outcome } = this.workflowMgr.begin(invocations, context, actor);
    return this.applyWorkflowOutcome(actor, sessionId, context, workflow, outcome, transcript, provider);
  }

  private async applyWorkflowOutcome(
    actor: VoiceActor,
    sessionId: string,
    baseContext: StoredSessionContext,
    wf: PendingWorkflow,
    outcome: WorkflowOutcome,
    transcript: string,
    provider = 'workflow',
  ): Promise<VoiceTurnResponse> {
    const base: StoredSessionContext = {
      ...baseContext,
      pendingTurn: undefined,
      pendingClarification: undefined,
    };

    if (outcome.kind === 'clarify') {
      await this.repo.updateContext(sessionId, { ...base, pendingWorkflow: wf });
      await this.repo.logCommand({
        sessionId,
        userId: actor.userId,
        transcript,
        intent: 'workflow',
        confidence: 1,
        status: VoiceCommandStatus.CLARIFYING,
        resultMessage: outcome.question,
        provider,
      });
      const inv = wf.pending[wf.awaitingIndex ?? 0];
      return {
        kind: 'clarify',
        sessionId,
        intent: inv?.intent ?? VoiceIntent.UNKNOWN,
        question: outcome.question,
        missingSlots: [outcome.awaitingSlot],
      };
    }

    if (outcome.kind === 'confirm') {
      await this.repo.updateContext(sessionId, { ...base, pendingWorkflow: wf });
      await this.repo.logCommand({
        sessionId,
        userId: actor.userId,
        transcript,
        intent: 'workflow',
        confidence: 1,
        plan: { steps: outcome.summary.lines },
        status: VoiceCommandStatus.AWAITING_CONFIRMATION,
        resultMessage: outcome.summary.title,
        provider,
      });
      return {
        kind: 'confirm',
        sessionId,
        planId: outcome.planId,
        intent: wf.pending[0]?.intent ?? VoiceIntent.UNKNOWN,
        summary: outcome.summary,
        requiredPermissions: [],
      };
    }

    if (outcome.kind === 'executed') {
      await this.repo.updateContext(sessionId, {
        ...base,
        ...wf.chain,
        pendingWorkflow: undefined,
      });
      await this.repo.logCommand({
        sessionId,
        userId: actor.userId,
        transcript,
        intent: 'workflow',
        confidence: 1,
        status: VoiceCommandStatus.EXECUTED,
        resultMessage: outcome.message,
        createdEntities: outcome.createdEntities,
        provider,
      });
      return {
        kind: 'executed',
        sessionId,
        intent: wf.completed[0]?.intent ?? VoiceIntent.UNKNOWN,
        result: { message: outcome.message, createdEntities: outcome.createdEntities },
        clientActions: outcome.clientActions,
      };
    }

    // rejected (incl. failed → compensated)
    await this.repo.updateContext(sessionId, { ...base, pendingWorkflow: undefined });
    await this.repo.logCommand({
      sessionId,
      userId: actor.userId,
      transcript,
      intent: 'workflow',
      confidence: 1,
      status: outcome.reason === 'failed' ? VoiceCommandStatus.FAILED : VoiceCommandStatus.REJECTED,
      errorCode: outcome.reason.toUpperCase(),
      errorMessage: outcome.message,
      provider,
    });
    return {
      kind: 'rejected',
      sessionId,
      reason: outcome.reason === 'failed' ? 'invalid' : outcome.reason,
      message: outcome.message,
      missingPermissions: outcome.missingPermissions,
    };
  }

  // ---------- internals ----------

  private async loadOrOpenSession(
    actor: VoiceActor,
    sessionId: string | undefined,
    locale: VoiceLocale,
  ): Promise<{ id: string; context: StoredSessionContext }> {
    if (sessionId) {
      const existing = await this.repo.findSession(sessionId, actor.userId);
      if (existing) {
        return { id: existing.id, context: (existing.context ?? {}) as StoredSessionContext };
      }
    }
    const created = await this.repo.createSession(actor.userId, locale);
    return { id: created.id, context: {} };
  }

  private async principal(actor: VoiceActor): Promise<VoicePrincipal> {
    const keys = await this.access.permissionsForRole(actor.role);
    return { userId: actor.userId, role: actor.role, permissions: new Set(keys) };
  }

  /** Rebuild and run the pending plan (shared by /decision confirm and voice "نعم"). */
  private async runPending(
    actor: VoiceActor,
    sessionId: string,
    context: StoredSessionContext,
  ): Promise<VoiceTurnResponse> {
    const pending = context.pendingTurn!;
    const handler = this.registry.get(pending.intent);
    if (!handler) {
      return this.executedText(sessionId, pending.intent, 'تعذّر تنفيذ الأمر.');
    }
    const outcome = await this.workflow.buildPlan(
      handler,
      pending.bag,
      context,
      actor,
      pending.transcript,
    );
    if (outcome.kind !== 'plan') {
      return this.executedText(sessionId, pending.intent, 'تعذّر إعادة بناء الأمر.');
    }

    // Re-validate permission at execution time (defence in depth).
    const principal = await this.principal(actor);
    const verdict = this.permission.evaluate(outcome.plan, principal);
    if (!verdict.allowed) {
      const cleared: StoredSessionContext = {
        ...context,
        pendingTurn: undefined,
        pendingClarification: undefined,
      };
      await this.repo.updateContext(sessionId, cleared);
      const res: RejectedResponse = {
        kind: 'rejected',
        sessionId,
        reason: 'permission_denied',
        message: 'ليس لديك صلاحية تنفيذ هذا الأمر.',
        missingPermissions: verdict.missing,
      };
      return res;
    }

    const clearedContext: StoredSessionContext = {
      ...context,
      pendingTurn: undefined,
      pendingClarification: undefined,
    };
    return this.runPlan(actor, sessionId, outcome.plan, clearedContext, {
      transcript: pending.transcript,
      normalized: pending.transcript,
      intent: pending.intent,
      confidence: 1,
      entities: [],
      provider: 'pending',
    });
  }

  private async runPlan(
    actor: VoiceActor,
    sessionId: string,
    plan: Plan,
    baseContext: StoredSessionContext,
    log: {
      transcript: string;
      normalized: string;
      intent: VoiceIntent;
      confidence: number;
      entities: unknown;
      provider: string;
    },
  ): Promise<VoiceTurnResponse> {
    try {
      const outcome = await this.executor.execute(plan, actor);

      // Update conversational memory / shared context — every produced id flows
      // back so a LATER standalone turn ("أضف دفعة", "اربط بالعقد") can use it.
      const nextContext: StoredSessionContext = {
        ...baseContext,
        ...(plan.contextPatch ?? {}),
        pendingTurn: undefined,
        pendingClarification: undefined,
      };
      const o = outcome.outputs;
      if (typeof o.projectId === 'string') nextContext.lastProjectId = o.projectId;
      if (typeof o.contractId === 'string') nextContext.lastContractId = o.contractId;
      if (typeof o.contractNumber === 'string') nextContext.lastContractNumber = o.contractNumber;
      if (typeof o.customerId === 'string') nextContext.lastCustomerId = o.customerId;
      if (typeof o.paymentId === 'string') nextContext.lastPaymentId = o.paymentId;
      await this.repo.updateContext(sessionId, nextContext);

      await this.repo.logCommand({
        sessionId,
        userId: actor.userId,
        transcript: log.transcript,
        normalized: log.normalized,
        intent: log.intent,
        confidence: log.confidence,
        entities: log.entities,
        plan: this.planSnapshot(plan),
        status: VoiceCommandStatus.EXECUTED,
        resultMessage: outcome.message,
        createdEntities: outcome.createdEntities,
        provider: log.provider,
      });

      const res: ExecutedResponse = {
        kind: 'executed',
        sessionId,
        intent: log.intent,
        result: { message: outcome.message, createdEntities: outcome.createdEntities },
        clientActions: outcome.clientActions,
      };
      return res;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'فشل التنفيذ';
      await this.repo.logCommand({
        sessionId,
        userId: actor.userId,
        transcript: log.transcript,
        normalized: log.normalized,
        intent: log.intent,
        confidence: log.confidence,
        entities: log.entities,
        plan: this.planSnapshot(plan),
        status: VoiceCommandStatus.FAILED,
        errorCode: 'EXECUTION_FAILED',
        errorMessage: message,
        provider: log.provider,
      });
      const res: ExecutedResponse = {
        kind: 'executed',
        sessionId,
        intent: log.intent,
        result: { message: `تعذّر تنفيذ الأمر: ${message}`, createdEntities: [] },
        clientActions: [{ type: 'toast', level: 'error', message: 'فشل تنفيذ الأمر الصوتي.' }],
      };
      return res;
    }
  }

  private async cancelPending(
    actor: VoiceActor,
    sessionId: string,
    context: StoredSessionContext,
    transcript: string,
  ): Promise<VoiceTurnResponse> {
    const cleared: StoredSessionContext = {
      ...context,
      pendingTurn: undefined,
      pendingClarification: undefined,
    };
    await this.repo.updateContext(sessionId, cleared);
    const cancelledIntent = context.pendingTurn?.intent ?? context.pendingClarification?.intent;
    if (cancelledIntent) {
      await this.repo.logCommand({
        sessionId,
        userId: actor.userId,
        transcript,
        intent: cancelledIntent,
        confidence: 1,
        status: VoiceCommandStatus.CANCELLED,
        resultMessage: 'أُلغيت العملية بناءً على طلب المستخدم.',
        provider: 'dialog',
      });
    }
    return this.executedText(sessionId, VoiceIntent.CANCEL, 'تم إلغاء العملية.');
  }

  private async help(
    actor: VoiceActor,
    sessionId: string,
    transcript: string,
    nlu: { normalized: string; confidence: number; provider: string },
  ): Promise<VoiceTurnResponse> {
    await this.repo.logCommand({
      sessionId,
      userId: actor.userId,
      transcript,
      normalized: nlu.normalized,
      intent: VoiceIntent.HELP,
      confidence: nlu.confidence,
      status: VoiceCommandStatus.EXECUTED,
      resultMessage: 'help',
      provider: nlu.provider,
    });
    const res: ExecutedResponse = {
      kind: 'executed',
      sessionId,
      intent: VoiceIntent.HELP,
      result: {
        message:
          'قل أمرك بلغتك العادية — أمثلة: إنشاء («سوي مشروع بيت مساحة 100»، «سوي عقد باسم أحمد»)، ' +
          'إضافة («أضف مصروف 500 ألف»، «سجّل دفعة مليون»)، ربط («اربط المشروع بالعقد رقم …»)، ' +
          'فتح وبحث («افتح مشروع فيلا أحمد»، «ابحث عن أحمد»)، حالة المشروع («أنجز المشروع»، «أوقف المشروع»)، ' +
          'وتنقّل («روح للمشاريع»).',
        createdEntities: [],
      },
      clientActions: [],
    };
    return res;
  }

  private executedText(sessionId: string, intent: VoiceIntent, message: string): ExecutedResponse {
    return {
      kind: 'executed',
      sessionId,
      intent,
      result: { message, createdEntities: [] },
      clientActions: [],
    };
  }

  private async rejectTurn(
    actor: VoiceActor,
    sessionId: string,
    transcript: string,
    nlu: { normalized: string; intent: VoiceIntent; confidence: number; entities: unknown; provider: string },
    rejection: { reason: RejectedResponse['reason']; message: string; missingPermissions?: string[] },
  ): Promise<RejectedResponse> {
    await this.repo.logCommand({
      sessionId,
      userId: actor.userId,
      transcript,
      normalized: nlu.normalized,
      intent: nlu.intent,
      confidence: nlu.confidence,
      entities: nlu.entities,
      status: VoiceCommandStatus.REJECTED,
      errorCode: rejection.reason.toUpperCase(),
      errorMessage: rejection.message,
      provider: nlu.provider,
    });
    return {
      kind: 'rejected',
      sessionId,
      reason: rejection.reason,
      message: rejection.message,
      missingPermissions: rejection.missingPermissions,
    };
  }

  private allPerms(plan: Plan): string[] {
    const set = new Set<string>(plan.requiredPermissions);
    for (const step of plan.steps) for (const p of step.requiredPermissions) set.add(p);
    return [...set];
  }

  /** A serialisable view of a plan (closures stripped) for the audit log. */
  private planSnapshot(plan: Plan): Record<string, unknown> {
    return {
      intent: plan.intent,
      side: plan.side,
      mutates: plan.mutates,
      requiredPermissions: this.allPerms(plan),
      steps: plan.steps.map((s) => ({
        description: s.description,
        requiredPermissions: s.requiredPermissions,
      })),
      summary: plan.summary,
      isServerIntent: isServerIntent(plan.intent),
    };
  }
}

/** Drop undefined keys so a fresh-turn bag never erases a remembered slot. */
function stripUndefined(obj: EntityBag): EntityBag {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as EntityBag;
}
