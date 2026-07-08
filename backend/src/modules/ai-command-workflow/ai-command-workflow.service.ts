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
// ============================================================

import type { PrismaClient } from '@prisma/client';
import { SessionStore } from './ai-command-workflow.sessions.js';
import { buildActionDeps, getAction, isRegisteredAction, type ActionDeps } from './ai-command-workflow.registry.js';
import { executePlan } from './ai-command-workflow.executor.js';
import { buildRefineUserPrompt, buildSystemPrompt, buildUserPrompt } from './ai-command-workflow.prompts.js';
import { llmInterpretationSchema, LLM_INTERPRETATION_JSON_SCHEMA } from './ai-command-workflow.schemas.js';
import { AiCommandRepository } from './ai-command-workflow.repository.js';
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
  ClarificationOption,
  ClarificationResult,
  ConfirmResult,
  ConfirmationPlan,
  ExecContext,
  ExecutedActionInfo,
  InterpretResult,
  LlmInterpretation,
  PlanRefs,
  QueryResult,
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

// ---------------------------------------------------------------------------
// Arabic confirm / cancel vocabulary
// ---------------------------------------------------------------------------

const CONFIRM_WORDS = new Set([
  'نعم', 'اي', 'أي', 'إي', 'ايه', 'أيه', 'تمام', 'اكد', 'أكد', 'اكيد', 'أكيد',
  'توكل', 'نفذ', 'موافق', 'ماشي', 'اوكي', 'اوك', 'ok', 'okay', 'yes', 'y',
]);
const CANCEL_WORDS = new Set([
  'لا', 'الغي', 'ألغي', 'إلغاء', 'الغاء', 'وقف', 'تراجع', 'كنسل', 'cancel', 'no', 'n',
]);

/** Strip tashkeel/tatweel + normalize alef/ya so "أكِّد" and "اكد" compare equal. */
function normalizeArabic(input: string): string {
  return input
    .replace(/[ً-ٰٟـ]/g, '') // diacritics + tatweel
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .trim()
    .toLowerCase();
}

function classifyReply(text: string): 'confirm' | 'cancel' | 'other' {
  const words = normalizeArabic(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'other';
  // Cancel wins ties ("لا تنفذ" → cancel), so scan for a cancel word first.
  if (words.some((w) => CANCEL_WORDS.has(w))) return 'cancel';
  if (words.some((w) => CONFIRM_WORDS.has(w))) return 'confirm';
  return 'other';
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}
function hasSlot(data: Record<string, unknown>, slot: string): boolean {
  const v = data[slot];
  return v !== undefined && v !== null && String(v).trim() !== '';
}

const SLOT_LABELS_AR: Record<string, string> = {
  name: 'الاسم',
  area: 'المساحة (م²)',
  amount: 'المبلغ',
  status: 'الحالة',
  projectRef: 'المشروع',
  clientRef: 'العميل',
  contractRef: 'العقد',
  materialRef: 'المادة',
  description: 'الوصف',
  username: 'اسم المستخدم',
  password: 'كلمة المرور',
  roleName: 'الدور',
  dueDate: 'تاريخ الاستحقاق',
};

function slotQuestion(missing: string[]): string {
  const labels = missing.map((s) => SLOT_LABELS_AR[s] ?? s);
  return `أحتاج معلومات إضافية: ${labels.join('، ')}؟`;
}

// ---------------------------------------------------------------------------

interface ResolveResult {
  refs: PlanRefs;
  clarify?: { message: string; missingSlots: string[]; options?: ClarificationOption[] };
  reject?: { reason: string; message: string };
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
    const resolved = await this.resolveReferences(steps, hasMutation);
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
    const missing = this.missingSlots(steps, refs);
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
    const lacking = this.missingPermissions(steps, ctx);
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
      const data = await this.runQueries(steps, ctx, refs);
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
    const confirmationMessage = await this.buildConfirmationMessage(steps, refs, aiMessage);
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

  // ===================== resolution / validation =====================

  private async resolveReferences(steps: WorkflowStep[], _hasMutation: boolean): Promise<ResolveResult> {
    const refs: PlanRefs = {};
    const creates = (action: string) => steps.some((s) => s.action === action);
    const createsProject = creates('project.create');
    const createsContract = creates('contract.create');
    const createsMaterial = creates('material.create');

    // 1) Client (find_or_create): 0 → create, 1 → bind, >1 → clarify.
    const clientStep = steps.find(
      (s) => s.action === 'client.find_or_create' || s.action === 'client.create',
    );
    if (clientStep && clientStep.action === 'client.find_or_create') {
      const name = str(clientStep.data.name) ?? str(clientStep.data.clientRef);
      if (name) {
        const matches = await this.repo.findCustomersByName(name);
        if (matches.length === 1) refs.clientId = matches[0]!.id;
        else if (matches.length > 1) {
          return {
            refs,
            clarify: {
              message: `يوجد أكثر من عميل باسم "${name}". أي واحد تقصد؟`,
              missingSlots: ['clientId'],
              options: matches.map((m) => ({ slot: 'clientId', id: m.id, label: m.phone ? `${m.name} — ${m.phone}` : m.name })),
            },
          };
        } else refs.willCreateClient = true;
      }
    }

    // 1b) Existing customer target ("customerRef", e.g. customer.update) — fuzzy
    //     name/phone. Only when the plan does NOT create a client.
    if (!clientStep && !refs.clientId) {
      const custStep = steps.find((s) => str(s.data.customerRef));
      if (custStep) {
        const term = str(custStep.data.customerRef)!;
        const matches = await this.repo.searchCustomers(term);
        if (matches.length === 1) refs.clientId = matches[0]!.id;
        else if (matches.length === 0) {
          return { refs, clarify: { message: `لم أعثر على عميل بالاسم/الرقم "${term}".`, missingSlots: ['customerRef'] } };
        } else {
          return {
            refs,
            clarify: {
              message: `يوجد أكثر من عميل مطابق لـ "${term}". أي واحد تقصد؟`,
              missingSlots: ['clientId'],
              options: matches.map((m) => ({ slot: 'clientId', id: m.id, label: m.phone ? `${m.name} — ${m.phone}` : m.name })),
            },
          };
        }
      }
    }

    // 2) Existing project (unless the plan creates it).
    if (!createsProject) {
      const projStep = steps.find((s) => str(s.data.projectRef));
      if (projStep) {
        const name = str(projStep.data.projectRef)!;
        const matches = await this.repo.findProjectsByName(name);
        if (matches.length === 1) refs.projectId = matches[0]!.id;
        else if (matches.length === 0) {
          return { refs, clarify: { message: `لم أعثر على مشروع باسم "${name}". حدّد الاسم بدقة.`, missingSlots: ['projectRef'] } };
        } else {
          return {
            refs,
            clarify: {
              message: `يوجد أكثر من مشروع مشابه لـ "${name}". أي واحد تقصد؟`,
              missingSlots: ['projectId'],
              options: matches.map((p) => ({
                slot: 'projectId',
                id: p.id,
                label: p.contract ? `${p.name} — عقد ${p.contract.contractNumber}` : p.name,
              })),
            },
          };
        }
      }
    }

    // 3) Existing material (unless the plan creates it).
    if (!createsMaterial) {
      const matStep = steps.find((s) => str(s.data.materialRef));
      if (matStep) {
        const name = str(matStep.data.materialRef)!;
        const matches = await this.repo.findMaterialsByName(name);
        if (matches.length === 1) refs.materialId = matches[0]!.id;
        else if (matches.length === 0) {
          return { refs, clarify: { message: `لم أعثر على مادة باسم "${name}".`, missingSlots: ['materialRef'] } };
        } else {
          return {
            refs,
            clarify: {
              message: `يوجد أكثر من مادة مشابهة لـ "${name}". أي واحدة تقصد؟`,
              missingSlots: ['materialId'],
              options: matches.map((m) => ({ slot: 'materialId', id: m.id, label: `${m.name} (${m.unit})` })),
            },
          };
        }
      }
    }

    // 4) Existing contract by number (unless the plan creates it).
    if (!createsContract) {
      const cStep = steps.find((s) => {
        const ref = str(s.data.contractRef);
        return ref && ref !== 'created_contract';
      });
      if (cStep) {
        const num = str(cStep.data.contractRef)!;
        const contract = await this.repo.findContractByNumber(num);
        if (contract) refs.contractId = contract.id;
        else return { refs, clarify: { message: `لم أعثر على عقد رقم "${num}".`, missingSlots: ['contractRef'] } };
      }
    }

    // 5) Delete/mark targets — the most-recent cost/payment ("آخر مصروف/دفعة"),
    //    ALWAYS scoped to a resolved project. Without project context we must NOT
    //    fall back to the globally-latest record (that could delete/alter an
    //    unrelated project's data) — ask which project instead.
    if (creates('expense.delete')) {
      if (!refs.projectId) {
        return { refs, clarify: { message: 'أي مشروع؟ حدّد المشروع لحذف آخر مصروف فيه.', missingSlots: ['projectRef'] } };
      }
      const cost = await this.repo.lastCost(refs.projectId);
      if (!cost) return { refs, clarify: { message: 'لا يوجد مصروف للحذف.', missingSlots: ['expense'] } };
      refs.costId = cost.id;
    }
    if (creates('payment.mark_paid') || creates('payment.cancel')) {
      if (!refs.projectId) {
        return { refs, clarify: { message: 'أي مشروع؟ حدّد المشروع للتعامل مع آخر دفعة فيه.', missingSlots: ['projectRef'] } };
      }
      const payment = await this.repo.lastPayment(refs.projectId);
      if (!payment) return { refs, clarify: { message: 'لا توجد دفعة مطابقة.', missingSlots: ['payment'] } };
      refs.paymentId = payment.id;
    }

    return { refs };
  }

  private missingSlots(steps: WorkflowStep[], refs: PlanRefs): string[] {
    const availClient = !!refs.clientId || !!refs.willCreateClient || steps.some((s) => s.action.startsWith('client.'));
    const availContract = !!refs.contractId || steps.some((s) => s.action === 'contract.create');
    const availProject = !!refs.projectId || steps.some((s) => s.action === 'project.create');
    const availMaterial = !!refs.materialId || steps.some((s) => s.action === 'material.create');

    const missing = new Set<string>();
    for (const step of steps) {
      const def = getAction(step.action);
      if (!def) continue;
      for (const slot of def.requiredSlots) {
        if (slot === 'projectRef' && availProject) continue;
        if (slot === 'contractRef' && availContract) continue;
        if (slot === 'materialRef' && availMaterial) continue;
        if (slot === 'clientRef' && availClient) continue;
        if (slot === 'customerRef' && availClient) continue;
        if (!hasSlot(step.data, slot)) missing.add(slot);
      }
    }
    return [...missing];
  }

  private missingPermissions(steps: WorkflowStep[], ctx: ExecContext): string[] {
    const missing = new Set<string>();
    for (const step of steps) {
      const def = getAction(step.action);
      if (!def) continue;
      // Data-dependent actions (e.g. project.status.change) narrow to only the
      // permission the requested data actually needs.
      const required = def.resolveRequiredPermissions?.(step.data) ?? def.requiredPermissions;
      for (const perm of required) {
        if (!ctx.permissions.has(perm)) missing.add(perm);
      }
    }
    return [...missing];
  }

  private async runQueries(steps: WorkflowStep[], ctx: ExecContext, refs: PlanRefs): Promise<unknown> {
    const results: unknown[] = [];
    for (const step of steps) {
      const def = getAction(step.action);
      if (def?.runQuery) results.push(await def.runQuery(this.deps, ctx, step.data, refs));
    }
    return results.length === 1 ? results[0] : results;
  }

  /** DB-sourced old→new confirmation for project.update; otherwise the AI's
   *  message (or a generated default). */
  private async buildConfirmationMessage(
    steps: WorkflowStep[],
    refs: PlanRefs,
    aiMessage: string | undefined,
  ): Promise<string> {
    const updateStep = steps.find((s) => s.action === 'project.update');
    if (updateStep && refs.projectId) {
      try {
        const project = await this.deps.projects.getById(refs.projectId);
        const changes: string[] = [];
        const newName = str(updateStep.data.name);
        if (newName) changes.push(`الاسم من "${project.name}" إلى "${newName}"`);
        const newProgress = str(updateStep.data.progressPercentage);
        if (newProgress) changes.push(`نسبة الإنجاز من ${Number(project.progressPercentage)}% إلى ${newProgress}%`);
        const newArea = str(updateStep.data.area);
        if (newArea && project.contract) {
          const contract = await this.deps.contracts.getById(project.contract.id);
          changes.push(`المساحة من ${Number(contract.buildingArea)} م² إلى ${newArea} م²`);
        }
        if (changes.length > 0) {
          return `راح أغيّر لمشروع "${project.name}": ${changes.join('، ')}. هل تؤكد؟`;
        }
      } catch {
        /* fall through to default */
      }
    }

    // customer.update → show DB-sourced old→new for each changed field.
    const custStep = steps.find((s) => s.action === 'customer.update');
    if (custStep && refs.clientId) {
      try {
        const customer = await this.deps.prisma.customer.findUnique({ where: { id: refs.clientId } });
        if (customer) {
          const changes: string[] = [];
          const fields: Array<[string, string, string | null]> = [
            ['الاسم', str(custStep.data.name) ?? '', customer.name],
            ['الهاتف', str(custStep.data.phone) ?? '', customer.phone],
            ['البريد', str(custStep.data.email) ?? '', customer.email],
            ['العنوان', str(custStep.data.address) ?? '', customer.address],
          ];
          for (const [label, next, current] of fields) {
            if (next) changes.push(`${label} من "${current ?? '—'}" إلى "${next}"`);
          }
          if (changes.length > 0) {
            return `راح أعدّل بيانات العميل "${customer.name}": ${changes.join('، ')}. هل تؤكد؟`;
          }
        }
      } catch {
        /* fall through to default */
      }
    }

    // expense.delete → name the exact cost being removed.
    const delStep = steps.find((s) => s.action === 'expense.delete');
    if (delStep && refs.costId) {
      const cost = await this.deps.prisma.projectCost.findUnique({ where: { id: refs.costId } });
      if (cost) return `راح أحذف المصروف: ${cost.description} بمبلغ ${Number(cost.totalAmount)}. هل تؤكد؟`;
    }
    // payment.mark_paid / payment.cancel → name the exact payment.
    const payStep = steps.find((s) => s.action === 'payment.mark_paid' || s.action === 'payment.cancel');
    if (payStep && refs.paymentId) {
      const pay = await this.deps.prisma.payment.findUnique({ where: { id: refs.paymentId } });
      if (pay) {
        const verb = payStep.action === 'payment.mark_paid' ? 'أأكّد دفع' : 'ألغي';
        return `راح ${verb} الدفعة بمبلغ ${Number(pay.amount)}. هل تؤكد؟`;
      }
    }

    if (aiMessage && aiMessage.trim()) return aiMessage.trim();
    const labels = steps.map((s) => s.action).join('، ');
    return `راح أنفّذ: ${labels}. هل تؤكد؟`;
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

// ---------------------------------------------------------------------------
// module-level helpers
// ---------------------------------------------------------------------------

/** Extract + validate the model's JSON. Tolerates surrounding prose/code fences. */
function parseInterpretation(raw: string): LlmInterpretation | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  const result = llmInterpretationSchema.safeParse(obj);
  return result.success ? (result.data as LlmInterpretation) : null;
}

const ENTITY_AR: Record<string, string> = {
  Customer: 'عميل',
  Contract: 'عقد',
  Project: 'مشروع',
  Payment: 'دفعة',
  ProjectCost: 'مصروف',
  Material: 'مادة',
  User: 'مستخدم',
  Role: 'دور',
  Currency: 'عملة',
  CompanyProfile: 'بيانات الشركة',
  SystemSetting: 'الإعدادات',
};

function buildExecutionMessage(actions: ExecutedActionInfo[]): string {
  const byOp: Record<'create' | 'update' | 'delete', Set<string>> = {
    create: new Set(),
    update: new Set(),
    delete: new Set(),
  };
  for (const a of actions) byOp[a.operation].add(ENTITY_AR[a.entity] ?? a.entity);
  const parts: string[] = [];
  if (byOp.create.size) parts.push(`تم إنشاء: ${[...byOp.create].join('، ')}`);
  if (byOp.update.size) parts.push(`تم تحديث: ${[...byOp.update].join('، ')}`);
  if (byOp.delete.size) parts.push(`تم حذف: ${[...byOp.delete].join('، ')}`);
  return parts.length ? `تم التنفيذ بنجاح. ${parts.join('. ')}.` : 'تم التنفيذ بنجاح.';
}

function buildQueryMessage(intent: string): string {
  if (intent.includes('summary')) return 'هذا ملخص المشروع.';
  return 'هذه نتيجة الاستعلام.';
}
