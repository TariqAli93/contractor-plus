// ============================================================
// Assistant Orchestrator — the ONE turn owner for every AI capability.
//
// Every turn is first classified into a conversation mode, and the mode decides
// everything downstream. Nothing below re-derives how the mode was chosen:
//
//   GENERAL   → a canned Arabic reply. No LLM, no quota, no tool, no plan.
//   QUESTION  → routed to a tool, answered immediately, and hard-gated so a
//               read-only question can never park a mutation.
//   WORKFLOW  → a guided conversation. The assistant gathers what it needs
//               (deterministically, no model call) and only hands off to the
//               tool once it has enough; the tool then owns its own draft.
//   COMMAND   → tool.interpret → confidence gate → park → confirm → execute.
//
// On top of that sit the platform engine parts (session manager, tool registry,
// executor, audit, confidence, context, memory), usage quota on real turns only,
// the wired conversation memory, and one unified AiExecution audit row.
//
// The AI only proposes; THIS layer decides, gates, confirms, and executes. It
// supersedes the (now-unused) PlatformOrchestrator; the two share the same public
// surface so the /ai routes and tests move over unchanged.
// ============================================================

import type { AiSession, PrismaClient } from '@prisma/client';
import { SessionManager } from '../ai-platform/session/session.manager.js';
import { ConversationMemory } from '../ai-platform/context/conversation-memory.js';
import { ContextEngine } from '../ai-platform/context/context-engine.js';
import { Planner } from '../ai-platform/planner/planner.js';
import { ConfidenceEngine } from '../ai-platform/confidence/confidence-engine.js';
import { PlatformAudit } from '../ai-platform/audit/platform-audit.js';
import { RuleEngine } from '../ai-platform/rules/rule-engine.js';
import { buildToolDeps, ToolRegistry } from '../ai-platform/registry/tool-registry.js';
import { assertPermitted, assertRegistered } from '../ai-platform/executor/permission-validator.js';
import { executePlan } from '../ai-platform/executor/tool-executor.js';
import { buildRegistry, registerToolRules } from '../ai-platform/tools/index.js';
import type { PlatformContext, SessionHandle, Tool } from '../ai-platform/registry/tool.contract.js';
import type { Plan, Principal, ToolTurnResult } from '../ai-platform/ai-platform.types.js';
import { CommandTool } from './command/command.tool.js';
import { IntentRouter } from './intent-router.js';
import { UsageGovernor, type QuotaConfig } from './usage-governor.js';
import { classifyTurn, type ConversationMode, type ConversationTurn } from './conversation-mode.js';
import {
  applyAnswer,
  composeRequest,
  gapQuestion,
  newBrief,
  nextGap,
  readBrief,
  WORKFLOW_TOOL,
  type EstimationBrief,
} from './workflow.js';
import {
  CANCELLED_MESSAGE,
  CAPABILITY_INTRO,
  CAPABILITY_SUGGESTIONS,
  GREETING_MESSAGE,
  NO_PENDING_MESSAGE,
  READ_ONLY_QUESTION_MESSAGE,
  SMALLTALK_MESSAGES,
  STATUS_IDLE_MESSAGE,
  statusPendingMessage,
} from './capabilities.js';
import { AccessService } from '../rbac/access.service.js';
import { LLMError, type LlmClient } from '../../lib/llm/llm-client.js';
import { AppError } from '../../shared/errors/app-error.js';
import { logger } from '../../lib/logger.js';
import type {
  AiSessionSummary,
  AiSessionView,
  AiToolInfo,
  PlatformCancelResult,
  PlatformConfirmResult,
  PlatformMessageResult,
} from '@contractor-plus/shared';

// Reason codes that mean "the request was understood but the AI provider could
// not serve it" — surfaced as a clean `error` (retryable), never a `rejected`
// (a valid "no"). A tool may either THROW an LLMError (CommandTool) or CATCH it
// and return a rejected turn carrying the code (EstimationTool) — both land here.
const LLM_ERROR_REASONS = new Set([
  'timeout', 'rate_limited', 'network_error', 'server_error', 'malformed_response', 'llm_unavailable', 'llm_error',
]);

export class AssistantOrchestrator {
  private readonly sessions: SessionManager;
  private readonly registry: ToolRegistry;
  private readonly rules: RuleEngine;
  private readonly memory: ConversationMemory;
  private readonly context: ContextEngine;
  private readonly intent: IntentRouter;
  private readonly planner: Planner;
  private readonly confidence: ConfidenceEngine;
  private readonly audit: PlatformAudit;
  private readonly access: AccessService;
  private readonly governor: UsageGovernor;
  /** Domain-service bag — stateless, built ONCE and reused across turns. */
  private readonly toolDeps: ReturnType<typeof buildToolDeps>;

  constructor(
    private readonly prisma: PrismaClient,
    /** Injected LLM client for tests; threaded to every tool that owns a model call. */
    injectedClient?: LlmClient,
    /** Test/config seam — override the per-user usage quota. */
    options?: { quota?: Partial<QuotaConfig> },
  ) {
    this.sessions = new SessionManager(prisma);
    this.registry = buildRegistry(); // EstimationTool
    this.registry.register(CommandTool); // + the bridged command capability
    this.rules = new RuleEngine();
    registerToolRules(this.rules, this.registry);
    this.memory = new ConversationMemory(this.sessions);
    this.context = new ContextEngine();
    this.intent = new IntentRouter(this.registry);
    this.planner = new Planner();
    this.confidence = new ConfidenceEngine();
    this.audit = new PlatformAudit(prisma);
    this.access = new AccessService(prisma);
    this.governor = new UsageGovernor(prisma, options?.quota);
    this.toolDeps = buildToolDeps(prisma, injectedClient);
  }

  // ===================== session lifecycle =====================

  async openSession(principal: Principal, title?: string): Promise<AiSessionSummary> {
    return toSummary(await this.sessions.open(principal.userId, title));
  }

  async listSessions(principal: Principal): Promise<AiSessionSummary[]> {
    return (await this.sessions.list(principal.userId)).map(toSummary);
  }

  async getSession(sessionId: string, principal: Principal): Promise<AiSessionView> {
    const session = await this.sessions.load(sessionId, principal.userId, false);
    const messages = await this.sessions.messages(sessionId);
    return {
      ...toSummary(session),
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        kind: m.kind as AiSessionView['messages'][number]['kind'],
        content: m.content,
        toolName: m.toolName,
        confidence: m.confidence,
        createdAt: m.createdAt.toISOString(),
      })),
      workingState: session.workingState ?? null,
      pendingSummary: session.pendingPlan ? (session.pendingPlan as unknown as Plan).summary ?? null : null,
    };
  }

  async listTools(principal: Principal): Promise<AiToolInfo[]> {
    const ctx = await this.buildContext(principal);
    return this.registry
      .list()
      .filter(
        (tool) =>
          this.canUseTool(tool, ctx) ||
          tool.actions.some((a) => a.requiredPermissions.every((p) => ctx.permissions.has(p))),
      )
      .map((tool) => ({
        name: tool.name,
        displayName: tool.displayName,
        renderKind: tool.renderKind,
        permissionModule: tool.permissionModule,
        actions: tool.actions
          .filter((a) => a.requiredPermissions.every((p) => ctx.permissions.has(p)))
          .map((a) => ({ name: a.name, description: a.description, kind: a.kind, requiredPermissions: a.requiredPermissions })),
      }));
  }

  // ===================== the turn =====================

  async message(sessionId: string, text: string, principal: Principal): Promise<PlatformMessageResult> {
    const session = await this.sessions.load(sessionId, principal.userId, true);
    await this.sessions.appendMessage(session, { role: 'USER', kind: 'command', content: text });

    const hasPending = session.status === 'AWAITING_CONFIRMATION' && session.pendingPlan != null;
    // A guided conversation is open either because the assistant is still
    // gathering facts, or because a tool is refining a draft it owns.
    const brief = session.activeTool === WORKFLOW_TOOL ? readBrief(session.workingState) : null;
    const toolDraft =
      session.activeTool != null && session.activeTool !== WORKFLOW_TOOL && session.workingState != null;

    const turn = classifyTurn(text, {
      hasPendingPlan: hasPending,
      workflow: brief ? 'brief' : toolDraft ? 'tool' : null,
    });

    if (turn.kind === 'control') {
      if (turn.action === 'confirm') return this.confirm(sessionId, principal);
      // A parked mutation is cancelled outright; abandoning a guided conversation
      // only drops what was gathered — the session stays open.
      if (hasPending) {
        await this.cancel(sessionId, principal);
        return this.answer(session, CANCELLED_MESSAGE);
      }
      return this.abandonWorkflow(session, principal);
    }

    // ---- GENERAL: a real conversation, never a command. No LLM, no quota. ----
    if (turn.mode === 'GENERAL') return this.general(session, turn, hasPending);

    // ---- WORKFLOW: gather first; hand off only once we know enough. ----
    if (turn.mode === 'WORKFLOW' && !toolDraft) return this.gather(session, text, brief, principal);

    return this.runTool(session, text, turn.mode, principal);
  }

  /** The canned side of the assistant's voice. Costs nothing, touches nothing. */
  private general(
    session: AiSession,
    turn: Extract<ConversationTurn, { mode: 'GENERAL' }>,
    hasPending: boolean,
  ): Promise<PlatformMessageResult> {
    switch (turn.reply) {
      case 'help':
        return this.answer(session, CAPABILITY_INTRO, CAPABILITY_SUGGESTIONS);
      case 'greeting':
        return this.answer(session, GREETING_MESSAGE, CAPABILITY_SUGGESTIONS);
      case 'smalltalk':
        return this.answer(session, SMALLTALK_MESSAGES[turn.topic]);
      case 'no_pending':
        return this.answer(session, NO_PENDING_MESSAGE);
      case 'status': {
        const summary = hasPending ? (session.pendingPlan as unknown as Plan).summary ?? null : null;
        return this.answer(session, hasPending ? statusPendingMessage(summary) : STATUS_IDLE_MESSAGE);
      }
    }
  }

  /** One turn of a guided conversation. Asks for the next missing fact — no
   *  model call, no quota, no plan, no confirmation — and only when the brief is
   *  complete does it compose the whole request and hand it to the tool. */
  private async gather(
    session: AiSession,
    text: string,
    existing: EstimationBrief | null,
    principal: Principal,
  ): Promise<PlatformMessageResult> {
    let current = session;
    const opening = existing === null;
    const brief = applyAnswer(existing ?? newBrief(text), text);

    const gap = nextGap(brief);
    if (gap) {
      // Starting a new conversation supersedes anything left parked.
      if (current.status === 'AWAITING_CONFIRMATION') current = await this.sessions.clearPlan(current);
      current = await this.sessions.saveWorkingState(current, WORKFLOW_TOOL, { ...brief, awaiting: gap });

      const nothingKnown = brief.area === null && brief.floors === null && brief.scope === null;
      const question = gapQuestion(gap, { opening: opening && nothingKnown });
      await this.sessions.appendMessage(current, {
        role: 'ASSISTANT',
        kind: 'clarification',
        content: question.question,
      });
      return {
        kind: 'clarification',
        sessionId: current.id,
        question: question.question,
        missing: question.missing,
        options: question.options,
        confidence: 0.9,
      };
    }

    // Enough information — the tool takes over, and owns the draft from here.
    current = await this.sessions.clearWorkingState(current);
    return this.runTool(current, composeRequest(brief), 'WORKFLOW', principal);
  }

  /** Drop a guided conversation without killing the session. A tool that owns a
   *  live draft gets to clean it up first. */
  private async abandonWorkflow(session: AiSession, principal: Principal): Promise<PlatformMessageResult> {
    const toolName = session.activeTool;
    if (toolName && toolName !== WORKFLOW_TOOL) {
      const tool = this.registry.get(toolName);
      if (tool?.onCancel) {
        const ctx = await this.buildContext(principal);
        await tool.onCancel(ctx, this.makeHandle(session, toolName)).catch(() => {});
      }
    }
    const cleared = await this.sessions.clearWorkingState(session);
    return this.answer(cleared, CANCELLED_MESSAGE);
  }

  /** The real AI turn: quota → memory → tool.interpret → gates → park. */
  private async runTool(
    input: AiSession,
    text: string,
    mode: ConversationMode,
    principal: Principal,
  ): Promise<PlatformMessageResult> {
    let session = input;
    const ctxBase = await this.buildContext(principal);

    // Usage quota — only real turns count (canned answers and the gathering
    // questions above are free).
    const verdict = await this.governor.check(principal.userId);
    if (!verdict.allowed) {
      return { kind: 'error', sessionId: session.id, reason: verdict.reason ?? 'quota_exceeded', message: verdict.message ?? 'تم تجاوز حد الاستخدام.' };
    }

    // A fresh command supersedes any parked plan.
    if (session.status === 'AWAITING_CONFIRMATION') session = await this.sessions.clearPlan(session);

    // WIRE conversation memory: prior turns → a compact preamble the tool's own
    // LLM call receives, so the user never repeats context.
    const preamble = await this.memory.buildPreamble(session);
    const ctx: PlatformContext = { ...ctxBase, conversation: { preamble } };

    const routed = this.intent.route(session, mode);
    const tool = routed.targetTool ? this.registry.get(routed.targetTool) : undefined;
    if (!tool || !tool.interpret) {
      return this.rejected(session, 'no_tool', 'ما أكدر أنفّذ هذا الطلب حالياً.');
    }
    if (!this.canUseTool(tool, ctx)) {
      return this.rejected(session, 'insufficient_permission', 'ما عندك صلاحية لهذا الطلب.');
    }

    await this.context.resolve(session, {
      objective: `${tool.name}.interpret`,
      targetTool: tool.name,
      entities: {},
      missingInfo: [],
      confidence: routed.confidence,
    });

    const handle = this.makeHandle(session, tool.name);

    let turn: ToolTurnResult;
    try {
      turn = await tool.interpret(ctx, handle, text);
    } catch (err) {
      return this.toolError(session, tool.name, err, text, principal.userId);
    }

    if (turn.kind === 'rejected') {
      await this.recordAudit({ session, userId: principal.userId, toolName: tool.name, originalRequest: text, transactionResult: turn.reason === undefined ? 'not_required' : LLM_ERROR_REASONS.has(turn.reason) ? 'failed' : 'not_required', failedReason: turn.reason });
      // A tool that CAUGHT an LLM failure reports it as a rejected turn with the
      // provider code — surface that as a clean `error`, not a plain rejection.
      if (LLM_ERROR_REASONS.has(turn.reason)) {
        return this.errorResult(session, tool.name, turn.reason, turn.message);
      }
      return this.rejected(session, turn.reason, turn.message);
    }
    if (turn.kind === 'clarification') {
      await this.sessions.appendMessage(session, { role: 'ASSISTANT', kind: 'clarification', content: turn.question, toolName: tool.name, confidence: turn.confidence });
      return { kind: 'clarification', sessionId: session.id, question: turn.question, missing: turn.missing, options: turn.options, confidence: turn.confidence };
    }
    if (turn.kind === 'query') {
      await this.sessions.appendMessage(session, { role: 'ASSISTANT', kind: 'query', content: turn.message, toolName: tool.name });
      await this.recordAudit({ session, userId: principal.userId, toolName: tool.name, originalRequest: text, transactionResult: 'not_required' });
      return { kind: 'query', sessionId: session.id, toolName: tool.name, message: turn.message, data: turn.data };
    }

    // A question is read-only, full stop. If the model read a question as a data
    // change, the change dies here — it is never parked, let alone executed.
    if (mode === 'QUESTION' && turn.requiresConfirmation) {
      await this.recordAudit({
        session, userId: principal.userId, toolName: tool.name, originalRequest: text,
        transactionResult: 'not_required', failedReason: 'read_only_question',
      });
      return this.rejected(session, 'read_only_question', READ_ONLY_QUESTION_MESSAGE);
    }

    // preview — confidence gate (the program, not the AI).
    const score = this.confidence.score({ intent: routed.confidence, context: turn.confidence, catalogMatch: turn.confidence });
    if (turn.requiresConfirmation && this.confidence.gate(score) === 'clarify') {
      const question = 'لست متأكداً بما يكفي لتنفيذ هذا الطلب. ممكن توضّح أكثر؟';
      await this.sessions.appendMessage(session, { role: 'ASSISTANT', kind: 'clarification', content: question, toolName: tool.name, confidence: score });
      return { kind: 'clarification', sessionId: session.id, question, missing: [], confidence: score };
    }

    await this.sessions.appendMessage(session, { role: 'ASSISTANT', kind: 'preview', content: turn.summary, toolName: tool.name, confidence: turn.confidence });
    if (turn.requiresConfirmation && turn.confirmStep) {
      const plan = this.planner.planConfirmation(turn.confirmStep, turn.summary, turn.confidence);
      session = await this.sessions.parkPlan(session, plan, tool.name);
    }
    return {
      kind: 'preview', sessionId: session.id, toolName: tool.name, renderKind: turn.renderKind,
      summary: turn.summary, warnings: turn.warnings, payload: turn.payload,
      requiresConfirmation: turn.requiresConfirmation, confidence: turn.confidence,
    };
  }

  async confirm(sessionId: string, principal: Principal): Promise<PlatformConfirmResult> {
    const ctx = await this.buildContext(principal);
    const session = await this.sessions.load(sessionId, principal.userId, true);
    const plan = session.pendingPlan as unknown as Plan | null;
    if (!plan || session.status !== 'AWAITING_CONFIRMATION') {
      return { kind: 'rejected', sessionId, reason: 'no_pending_plan', message: NO_PENDING_MESSAGE };
    }
    const toolName = plan.steps[0]?.toolName ?? session.activeTool ?? null;

    // Fail-closed BEFORE any write, and BEFORE the claim, so a permission error
    // leaves the plan parked for a retry rather than consuming it.
    assertRegistered(plan, this.registry);
    assertPermitted(plan, ctx, this.registry);

    // Atomic claim — the sole winner executes; a racing /confirm is rejected.
    if (!(await this.sessions.claim(session))) {
      return { kind: 'rejected', sessionId, reason: 'no_pending_plan', message: NO_PENDING_MESSAGE };
    }

    const handle = this.makeHandle(session, toolName ?? '');
    try {
      const result = await executePlan(this.prisma, this.registry, handle, plan, ctx);
      await this.sessions.complete(session);
      await this.sessions.appendMessage(session, { role: 'ASSISTANT', kind: 'execution', content: 'تم التنفيذ بنجاح.', toolName });
      await this.recordAudit({
        session, userId: principal.userId, toolName, originalRequest: session.title ?? '',
        plannerOutput: plan.steps, selectedTools: plan.steps.map((s) => s.action),
        userApproval: { confirmed: true }, executedActions: result.executedActions,
        finalData: result.result, transactionResult: 'executed', confidence: session.confidence,
      });
      return {
        kind: 'execution', sessionId, toolName, message: 'تم الحفظ بنجاح.',
        executedActions: result.executedActions, createdEntityIds: result.createdEntityIds, result: result.result,
      };
    } catch (err) {
      await this.sessions.markFailed(session).catch(() => {});
      const reason = err instanceof AppError ? err.code : err instanceof Error ? err.message : 'unknown_error';
      await this.recordAudit({
        session, userId: principal.userId, toolName, originalRequest: session.title ?? '',
        plannerOutput: plan.steps, transactionResult: 'failed', failedReason: reason,
      });
      throw err;
    }
  }

  async cancel(sessionId: string, principal: Principal): Promise<PlatformCancelResult> {
    const ctx = await this.buildContext(principal);
    const session = await this.sessions.load(sessionId, principal.userId, false);
    const plan = session.pendingPlan as unknown as Plan | null;
    const toolName = plan?.steps[0]?.toolName ?? session.activeTool ?? null;
    if (toolName) {
      const tool = this.registry.get(toolName);
      if (tool?.onCancel) await tool.onCancel(ctx, this.makeHandle(session, toolName)).catch(() => {});
    }
    await this.sessions.cancel(session);
    await this.recordAudit({ session, userId: principal.userId, toolName, originalRequest: session.title ?? '', transactionResult: 'cancelled' });
    return { kind: 'cancelled', sessionId, message: 'تم إلغاء الجلسة.' };
  }

  // ===================== internals =====================

  private async buildContext(principal: Principal): Promise<PlatformContext> {
    // Live re-check (active + CURRENT role from DB) — a deactivated user is
    // rejected; a role change takes effect within seconds.
    const role = await this.access.liveUserRole(principal.userId);
    const keys = await this.access.permissionsForRole(role);
    return { ...principal, role, permissions: new Set(keys), deps: this.toolDeps, rules: this.rules };
  }

  private canUseTool(tool: Tool | undefined, ctx: PlatformContext): boolean {
    if (!tool) return false;
    if (!tool.interpretPermissions || tool.interpretPermissions.length === 0) return true;
    return tool.interpretPermissions.every((p) => ctx.permissions.has(p));
  }

  private makeHandle(session: AiSession, toolName: string): SessionHandle {
    const sessions = this.sessions;
    return {
      id: session.id,
      userId: session.userId,
      get workingState() {
        return session.workingState ?? null;
      },
      contextRefs: (session.contextRefs as Record<string, string> | null) ?? {},
      setWorkingState: async (state: unknown) => {
        const updated = await sessions.saveWorkingState(session, toolName, state);
        session.workingState = updated.workingState;
        session.activeTool = updated.activeTool;
      },
    };
  }

  /** Map an interpret() THROW to a clean result + an audit row. An LLMError
   *  becomes a friendly `error`; anything else is a coded `rejected`. */
  private async toolError(
    session: AiSession,
    toolName: string,
    err: unknown,
    text: string,
    userId: string,
  ): Promise<PlatformMessageResult> {
    const reason = err instanceof LLMError || err instanceof AppError ? err.code : 'tool_error';
    await this.recordAudit({ session, userId, toolName, originalRequest: text, transactionResult: 'failed', failedReason: reason });
    if (err instanceof LLMError) {
      return this.errorResult(session, toolName, reason, 'تعذّر تنفيذ الطلب عبر مزوّد الذكاء الاصطناعي، حاول مرة أخرى.');
    }
    return this.rejected(session, reason, 'تعذّر تنفيذ الطلب، حاول مرة أخرى.');
  }

  /** A clean, retryable `error` result with the right Arabic copy — the
   *  estimation-specific timeout wording, otherwise the provided fallback. */
  private async errorResult(session: AiSession, toolName: string, reason: string, fallback: string): Promise<PlatformMessageResult> {
    const message =
      reason === 'timeout'
        ? toolName === 'estimation'
          ? 'استغرق إنشاء التقدير وقتاً أطول من المتوقع. جرّب تختصر الطلب أو أعد المحاولة.'
          : 'استغرق تنفيذ الطلب وقتاً أطول من المتوقع. جرّب تختصر الطلب أو أعد المحاولة.'
        : fallback;
    await this.sessions.appendMessage(session, { role: 'ASSISTANT', kind: 'error', content: message, toolName }).catch(() => {});
    return { kind: 'error', sessionId: session.id, reason, message };
  }

  private async answer(session: AiSession, message: string, suggestions?: string[]): Promise<PlatformMessageResult> {
    await this.sessions.appendMessage(session, { role: 'ASSISTANT', kind: 'answer', content: message }).catch(() => {});
    return { kind: 'answer', sessionId: session.id, message, suggestions };
  }

  private async rejected(session: AiSession, reason: string, message: string): Promise<PlatformMessageResult> {
    await this.sessions.appendMessage(session, { role: 'ASSISTANT', kind: 'rejected', content: message }).catch(() => {});
    return { kind: 'rejected', sessionId: session.id, reason, message };
  }

  /** Single audit sink — every real turn writes one AiExecution (never silent). */
  private async recordAudit(input: {
    session: AiSession;
    userId: string;
    toolName?: string | null;
    originalRequest: string;
    parsedIntent?: unknown;
    plannerOutput?: unknown;
    selectedTools?: unknown;
    userApproval?: unknown;
    executedActions?: unknown;
    finalData?: unknown;
    transactionResult: 'executed' | 'failed' | 'cancelled' | 'not_required';
    confidence?: number;
    failedReason?: string;
  }): Promise<void> {
    await this.audit
      .record({
        sessionId: input.session.id,
        userId: input.userId,
        toolName: input.toolName ?? null,
        originalRequest: input.originalRequest,
        parsedIntent: input.parsedIntent,
        plannerOutput: input.plannerOutput,
        selectedTools: input.selectedTools,
        userApproval: input.userApproval,
        executedActions: input.executedActions,
        finalData: input.finalData,
        transactionResult: input.transactionResult,
        confidence: input.confidence,
        failedReason: input.failedReason,
      })
      .catch((e) => logger.error({ err: e, sessionId: input.session.id, userId: input.userId }, 'assistant audit write failed'));
  }
}

function toSummary(s: AiSession): AiSessionSummary {
  return {
    id: s.id,
    title: s.title,
    status: s.status,
    activeTool: s.activeTool,
    confidence: s.confidence,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}
