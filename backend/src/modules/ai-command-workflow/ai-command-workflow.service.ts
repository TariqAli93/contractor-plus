// ============================================================
// Service — the orchestration brain.
//
// interpret(): confirm/cancel-word handling for a pending plan → slot-fill
// continuation → LLM interpretation → validate (registered? permitted? slots?)
// → resolve entity references (existing records; ambiguity → clarification) →
// query executes immediately, mutation parks a resolved plan for confirmation.
// confirm()/cancel() act on the parked plan. Every turn is written to AiCommandLog.
//
// The AI only proposes; THIS layer (the program) decides and executes.
//
// The Arabic normalization + confirm/cancel classification + LLM-output parsing
// live in `./ai-command-workflow.arabic.js`; the deterministic program pass
// (resolve refs / slots / permissions / queries / confirmation message) lives in
// `./ai-command-workflow.program.js` — both shared with the unified assistant's
// CommandTool so the two entry points cannot drift.
// ============================================================

import type { PrismaClient } from '@prisma/client';
import { SessionStore } from './ai-command-workflow.sessions.js';
import { buildActionDeps, getAction, isRegisteredAction, type ActionDeps } from './ai-command-workflow.registry.js';
import { executePlan } from './ai-command-workflow.executor.js';
import { buildRefineUserPrompt, buildSystemPrompt, buildUserPrompt } from './ai-command-workflow.prompts.js';
import { LLM_INTERPRETATION_JSON_SCHEMA } from './ai-command-workflow.schemas.js';
import { AiCommandRepository } from './ai-command-workflow.repository.js';
import { classifyReply, parseInterpretation } from './ai-command-workflow.arabic.js';
import {
  buildConfirmationMessage,
  buildExecutionMessage,
  buildQueryMessage,
  missingPermissions,
  missingSlots,
  resolveReferences,
  runQueries,
  slotQuestion,
  str,
} from './ai-command-workflow.program.js';
import { AccessService } from '../rbac/access.service.js';
import { LlmSettingsStore } from '../../lib/llm/llm-settings.store.js';
import { createLlmClient, LLMError, type LlmClient } from '../../lib/llm/llm-client.js';
import { llmErrorMessageAr } from '../../lib/llm/llm-error-messages.js';
import type { LlmProviderName } from '../../lib/llm/llm.config.js';
import { logger } from '../../lib/logger.js';
import { AppError } from '../../shared/errors/app-error.js';
import type { AiInsights } from '@contractor-plus/shared';
import type {
  CancellationResult,
  ConfirmResult,
  ConfirmationPlan,
  ExecContext,
  InterpretResult,
  LlmInterpretation,
  RejectedResult,
  Session,
  StoredPlan,
  WorkflowStep,
} from './ai-command-workflow.types.js';

export interface Principal {
  userId: string;
  role: string;
  actor: { userId: string; ipAddress?: string; userAgent?: string };
}

export class AiCommandWorkflowService {
  private readonly deps: ActionDeps;
  private readonly sessions = new SessionStore();
  private readonly repo: AiCommandRepository;
  private readonly access: AccessService;
  private readonly llmSettings: LlmSettingsStore;

  constructor(
    private readonly prisma: PrismaClient,
    /** Injected LLM client for tests; production resolves one from settings. */
    private readonly injectedClient?: LlmClient,
  ) {
    this.deps = buildActionDeps(prisma);
    this.repo = new AiCommandRepository(prisma);
    this.access = new AccessService(prisma);
    this.llmSettings = new LlmSettingsStore(prisma);
  }

  // ===================== INTERPRET =====================

  async interpret(
    text: string,
    sessionId: string | undefined,
    principal: Principal,
  ): Promise<InterpretResult | CancellationResult> {
    const ctx = await this.buildContext(principal);
    const session = this.sessions.resolve(sessionId, principal.userId, text);

    // 1) A plan is parked → confirm/cancel words act on it; ANYTHING ELSE is a
    //    REFINEMENT of that plan (multi-turn context), not a new command.
    let refineFrom: StoredPlan | null = null;
    if (session.pendingPlan) {
      const reply = classifyReply(text);
      if (reply === 'confirm') return this.execute(session, ctx);
      if (reply === 'cancel') return this.cancelSession(session, ctx);
      refineFrom = session.pendingPlan;
      this.sessions.clearPending(session); // re-parked if the refined result is a plan
    }

    // 2) Accumulate the running command (so "مساحته 250" completes a prior turn).
    const priorText = str(session.collectedSlots.command);
    const combined = priorText && session.pendingIntent ? `${priorText} ${text}` : text;
    session.collectedSlots.command = combined;

    // 3) Interpret with the LLM.
    const llm = await this.resolveClient();
    if (!llm.client) {
      return this.rejected(session, 'llm_unavailable', 'المساعد الذكي غير مُفعّل. فعّل مزوّد الذكاء الاصطناعي من الإعدادات.', text, llm.provider);
    }
    let raw: string;
    try {
      raw = await llm.client.complete({
        system: buildSystemPrompt(),
        user: refineFrom
          ? buildRefineUserPrompt(refineFrom.originalText, refineFrom.steps, text)
          : buildUserPrompt(combined, session.collectedSlots, session.pendingIntent),
        schema: LLM_INTERPRETATION_JSON_SCHEMA,
      });
    } catch (err) {
      const code = err instanceof LLMError ? err.code : 'llm_error';
      return this.rejected(session, code, llmErrorMessageAr(code), text, llm.provider);
    }

    const parsed = parseInterpretation(raw);
    if (!parsed) {
      return this.rejected(session, 'invalid_ai_output', 'ما فهمت الطلب بوضوح، جرّب صياغة أوضح.', text, llm.provider);
    }

    return this.handleInterpretation(parsed, session, ctx, text, llm.provider);
  }

  private async handleInterpretation(
    parsed: LlmInterpretation,
    session: Session,
    ctx: ExecContext,
    originalText: string,
    provider: LlmProviderName | null,
  ): Promise<InterpretResult> {
    if (parsed.kind === 'rejected') {
      return this.rejected(session, 'not_understood', parsed.reason, originalText, provider, parsed.reason);
    }

    if (parsed.kind === 'clarification') {
      session.pendingIntent = parsed.intent ?? session.pendingIntent;
      session.missingSlots = parsed.missingSlots ?? [];
      this.sessions.save(session);
      await this.audit(session, 'clarification', parsed.intent ?? null, parsed.confidence ?? null, 'not_required', provider, {});
      return {
        kind: 'clarification',
        sessionId: session.sessionId,
        intent: parsed.intent ?? null,
        message: parsed.question,
        missingSlots: parsed.missingSlots ?? [],
      };
    }

    // workflow_plan | query — both carry steps.
    const steps = parsed.steps;
    const intent = parsed.intent;
    const confidence = parsed.confidence ?? 0.8;

    // (Req 10) Reject any unregistered action outright.
    const unregistered = steps.filter((s) => !isRegisteredAction(s.action));
    if (unregistered.length > 0) {
      return this.rejected(
        session,
        'unregistered_action',
        `النظام لا يدعم هذا الإجراء: ${unregistered.map((s) => s.action).join(', ')}`,
        originalText,
        provider,
        intent,
        steps,
      );
    }

    // The PROGRAM decides confirmation, not the AI: a plan that mutates ALWAYS
    // needs confirmation; a plan that only reads never does — regardless of the
    // label the model returned.
    const hasMutation = steps.some((s) => getAction(s.action)?.kind === 'mutation');

    // Resolve existing-record references.
    const resolved = await resolveReferences(this.repo, steps);
    if (resolved.reject) {
      return this.rejected(session, resolved.reject.reason, resolved.reject.message, originalText, provider, intent, steps);
    }
    if (resolved.clarify) {
      session.pendingIntent = intent;
      this.sessions.save(session);
      await this.audit(session, 'clarification', intent, confidence, 'not_required', provider, { steps });
      return {
        kind: 'clarification',
        sessionId: session.sessionId,
        intent,
        message: resolved.clarify.message,
        missingSlots: resolved.clarify.missingSlots,
        options: resolved.clarify.options,
      };
    }
    const refs = resolved.refs;

    // Required-slot completeness (accounting for refs threaded within the plan).
    const missing = missingSlots(steps, refs);
    if (missing.length > 0) {
      session.pendingIntent = intent;
      this.sessions.save(session);
      await this.audit(session, 'clarification', intent, confidence, 'not_required', provider, { steps });
      return {
        kind: 'clarification',
        sessionId: session.sessionId,
        intent,
        message: slotQuestion(missing),
        missingSlots: missing,
      };
    }

    // Permission gate (the program, not the AI).
    const lacking = missingPermissions(steps, ctx.permissions);
    if (lacking.length > 0) {
      return this.rejected(
        session,
        'insufficient_permission',
        `لا تملك صلاحية تنفيذ هذا الأمر (${lacking.join('، ')}).`,
        originalText,
        provider,
        intent,
        steps,
      );
    }

    // Pure query → run now, no confirmation.
    if (!hasMutation) {
      const data = await runQueries(this.deps, ctx, steps, refs);
      this.sessions.clearPending(session);
      await this.audit(session, 'query', intent, confidence, 'not_required', provider, { steps });
      return {
        kind: 'query',
        sessionId: session.sessionId,
        intent,
        message: buildQueryMessage(intent),
        data,
      };
    }

    // Mutation → park a resolved plan and ask for confirmation.
    const aiMessage = parsed.kind === 'workflow_plan' ? parsed.confirmationMessage : undefined;
    const confirmationMessage = await buildConfirmationMessage(this.deps, steps, refs, aiMessage);
    const stored: StoredPlan = { intent, confidence, steps, confirmationMessage, refs, originalText };
    session.pendingIntent = intent;
    session.pendingPlan = stored;
    this.sessions.save(session);
    await this.audit(session, 'workflow_plan', intent, confidence, 'pending', provider, { steps });

    const plan: ConfirmationPlan = {
      kind: 'workflow_plan',
      sessionId: session.sessionId,
      intent,
      confidence,
      requiresConfirmation: true,
      missingSlots: [],
      steps,
      confirmationMessage,
    };
    return plan;
  }

  // ===================== CONFIRM / CANCEL =====================

  async confirm(sessionId: string, principal: Principal): Promise<ConfirmResult> {
    const ctx = await this.buildContext(principal);
    const session = this.sessions.get(sessionId, principal.userId);
    if (!session || !session.pendingPlan) {
      return {
        kind: 'rejected',
        sessionId,
        intent: null,
        reason: 'no_pending_plan',
        message: 'لا توجد خطة معلّقة للتأكيد. اكتب الأمر من جديد.',
      };
    }
    return this.execute(session, ctx);
  }

  async cancel(sessionId: string, principal: Principal): Promise<CancellationResult | RejectedResult> {
    const ctx = await this.buildContext(principal);
    const session = this.sessions.get(sessionId, principal.userId);
    if (!session || !session.pendingPlan) {
      return {
        kind: 'rejected',
        sessionId,
        intent: null,
        reason: 'no_pending_plan',
        message: 'لا توجد خطة معلّقة للإلغاء.',
      };
    }
    return this.cancelSession(session, ctx);
  }

  getSession(sessionId: string, userId: string): Session | null {
    return this.sessions.get(sessionId, userId);
  }

  /** Proactive briefing shown when the console opens (permission-aware). Reuses
   *  ReportsService only — no new business logic. */
  async getInsights(principal: Principal): Promise<AiInsights> {
    const ctx = await this.buildContext(principal);
    if (!ctx.permissions.has('reports.read')) {
      return {
        hasReports: false,
        message: 'أهلاً 👋 اكتب أمرك بلغتك الطبيعية، مثل: «سويلي مشروع باسم محمد احمد مساحة 200 متر».',
        overduePayments: 0,
        delayedProjects: 0,
        monthlyProfit: null,
        topOverdueCustomer: null,
      };
    }
    const [dashboard, overdue] = await Promise.all([
      this.deps.reports.getDashboard(),
      this.deps.reports.getOverduePayments({}),
    ]);
    const top = overdue[0]
      ? { customerName: overdue[0].customerName, amount: overdue[0].totalOverdueAmount }
      : null;
    const alerts: string[] = [];
    if (dashboard.overduePayments > 0) alerts.push(`${dashboard.overduePayments} دفعة متأخرة`);
    if (dashboard.delayedProjects > 0) alerts.push(`${dashboard.delayedProjects} مشروع متأخر`);
    const message = alerts.length
      ? `تنبيه: ${alerts.join('، ')}${top?.customerName ? ` — أكثر متأخر: ${top.customerName}` : ''}. ربح هذا الشهر: ${dashboard.monthlyProfit}.`
      : `كل شيء منتظم ✅ ربح هذا الشهر: ${dashboard.monthlyProfit}.`;
    return {
      hasReports: true,
      message,
      overduePayments: dashboard.overduePayments,
      delayedProjects: dashboard.delayedProjects,
      monthlyProfit: dashboard.monthlyProfit,
      topOverdueCustomer: top,
    };
  }

  private async execute(session: Session, ctx: ExecContext): Promise<ConfirmResult> {
    // Claim the plan SYNCHRONOUSLY — before the first await — so two concurrent
    // /confirm requests cannot both execute it. The first caller to reach here in
    // this event-loop tick captures the plan and clears it; a second, racing
    // caller then sees no pending plan and is rejected instead of re-executing.
    const plan = session.pendingPlan;
    if (!plan) {
      return {
        kind: 'rejected',
        sessionId: session.sessionId,
        intent: null,
        reason: 'no_pending_plan',
        message: 'لا توجد خطة معلّقة للتأكيد. اكتب الأمر من جديد.',
      };
    }
    this.sessions.clearPending(session);

    try {
      const output = await executePlan(this.prisma, this.deps, plan, ctx);
      await this.audit(session, 'execution', plan.intent, plan.confidence, 'executed', null, {
        steps: plan.steps,
        executedActions: output.executedActions,
        createdEntityIds: output.createdEntityIds,
        updatedEntityIds: output.updatedEntityIds,
      });
      return {
        kind: 'execution',
        sessionId: session.sessionId,
        intent: plan.intent,
        message: buildExecutionMessage(output.executedActions),
        executedActions: output.executedActions,
        createdEntityIds: output.createdEntityIds,
        updatedEntityIds: output.updatedEntityIds,
      };
    } catch (err) {
      const message = err instanceof AppError ? err.message : 'فشل تنفيذ الأمر وتم التراجع عن كل التغييرات.';
      const reason = err instanceof AppError ? err.code : 'execution_failed';
      await this.audit(session, 'execution', plan.intent, plan.confidence, 'failed', null, {
        steps: plan.steps,
        failedReason: message,
      });
      return { kind: 'rejected', sessionId: session.sessionId, intent: plan.intent, reason, message };
    }
  }

  private async cancelSession(session: Session, _ctx: ExecContext): Promise<CancellationResult> {
    const intent = session.pendingPlan?.intent ?? null;
    this.sessions.clearPending(session);
    await this.audit(session, 'rejected', intent, null, 'cancelled', null, {});
    return {
      kind: 'cancelled',
      sessionId: session.sessionId,
      message: 'تم الإلغاء. لم يُنفّذ أي تغيير.',
    };
  }

  // ===================== plumbing =====================

  private async buildContext(principal: Principal): Promise<ExecContext> {
    // Live re-check (active + CURRENT role from DB) — do not trust the token's
    // role/active status for these mutating AI authorizations. Throws for a
    // deactivated/deleted user; a demoted user immediately loses elevated access.
    const role = await this.access.liveUserRole(principal.userId);
    const keys = await this.access.permissionsForRole(role);
    return { userId: principal.userId, role, actor: principal.actor, permissions: new Set(keys) };
  }

  private async resolveClient(): Promise<{ client: LlmClient | null; provider: LlmProviderName | null }> {
    if (this.injectedClient) return { client: this.injectedClient, provider: this.injectedClient.name };
    const cfg = await this.llmSettings.resolve();
    return { client: createLlmClient(cfg), provider: cfg.provider };
  }

  private async rejected(
    session: Session,
    reason: string,
    message: string,
    originalText: string,
    provider: LlmProviderName | null,
    intent: string | null = null,
    steps?: WorkflowStep[],
  ): Promise<RejectedResult> {
    await this.audit(session, 'rejected', intent, null, 'rejected', provider, { steps, failedReason: reason });
    return { kind: 'rejected', sessionId: session.sessionId, intent, reason, message };
  }

  private async audit(
    session: Session,
    resultKind: string,
    intent: string | null,
    confidence: number | null,
    confirmationStatus: string,
    provider: LlmProviderName | null,
    extra: {
      steps?: WorkflowStep[];
      executedActions?: unknown;
      createdEntityIds?: unknown;
      updatedEntityIds?: unknown;
      failedReason?: string;
    },
  ): Promise<void> {
    try {
      await this.repo.log({
        userId: session.userId,
        sessionId: session.sessionId,
        originalText: session.originalText,
        detectedIntent: intent,
        confidence,
        resultKind,
        confirmationStatus,
        failedReason: extra.failedReason ?? null,
        provider,
        generatedPlan: extra.steps,
        executedActions: extra.executedActions,
        createdEntityIds: extra.createdEntityIds,
        updatedEntityIds: extra.updatedEntityIds,
      });
    } catch (err) {
      // A post-commit audit failure must NOT roll back or fail the user's
      // operation (the mutation already committed in the executor's own
      // transaction), but it must NEVER be silent: an executed action with no
      // audit row is a compliance hole. Log loudly with enough context to
      // reconstruct the trail by hand.
      logger.error(
        { err, userId: session.userId, sessionId: session.sessionId, resultKind, confirmationStatus },
        '[ai-command] audit write failed — operation NOT rolled back; audit trail incomplete',
      );
    }
  }
}
