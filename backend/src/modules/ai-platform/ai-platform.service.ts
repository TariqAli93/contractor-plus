// ============================================================
// Platform Orchestrator — runs the pipeline for one turn:
//   session → memory → context → intent → planner → (tool interpret) →
//   permission validator → executor → audit.
// The AI only proposes; THIS layer decides, gates, confirms, and executes. It is
// the stage-separated fusion of ai-command's interpret/confirm and estimation's
// lifecycle, now generic over Tools.
// ============================================================

import type { AiSession, PrismaClient } from '@prisma/client';
import { SessionManager } from './session/session.manager.js';
import { ConversationMemory } from './context/conversation-memory.js';
import { ContextEngine } from './context/context-engine.js';
import { IntentParser } from './intent/intent-parser.js';
import { Planner } from './planner/planner.js';
import { ConfidenceEngine } from './confidence/confidence-engine.js';
import { PlatformAudit } from './audit/platform-audit.js';
import { RuleEngine } from './rules/rule-engine.js';
import { buildToolDeps, ToolRegistry } from './registry/tool-registry.js';
import { assertPermitted, assertRegistered } from './executor/permission-validator.js';
import { executePlan } from './executor/tool-executor.js';
import { buildRegistry, registerToolRules } from './tools/index.js';
import type { PlatformContext, SessionHandle, Tool } from './registry/tool.contract.js';
import type { Plan, ToolTurnResult } from './ai-platform.types.js';
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
import type { Principal } from './ai-platform.types.js';

export class PlatformOrchestrator {
  private readonly sessions: SessionManager;
  private readonly registry: ToolRegistry;
  private readonly rules: RuleEngine;
  private readonly memory: ConversationMemory;
  private readonly context: ContextEngine;
  private readonly intent: IntentParser;
  private readonly planner: Planner;
  private readonly confidence: ConfidenceEngine;
  private readonly audit: PlatformAudit;
  private readonly access: AccessService;

  constructor(
    private readonly prisma: PrismaClient,
    /** Injected LLM client for tests; threaded to tools that own a domain call. */
    private readonly injectedClient?: LlmClient,
  ) {
    this.sessions = new SessionManager(prisma);
    this.registry = buildRegistry();
    this.rules = new RuleEngine();
    registerToolRules(this.rules, this.registry);
    this.memory = new ConversationMemory(this.sessions);
    this.context = new ContextEngine();
    this.intent = new IntentParser(this.registry);
    this.planner = new Planner();
    this.confidence = new ConfidenceEngine();
    this.audit = new PlatformAudit(prisma);
    this.access = new AccessService(prisma);
  }

  // ===================== session lifecycle =====================

  async openSession(principal: Principal, title?: string): Promise<AiSessionSummary> {
    const s = await this.sessions.open(principal.userId, title);
    return toSummary(s);
  }

  async listSessions(principal: Principal): Promise<AiSessionSummary[]> {
    const rows = await this.sessions.list(principal.userId);
    return rows.map(toSummary);
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
    const ctx = await this.buildContext(principal);
    let session = await this.sessions.load(sessionId, principal.userId, true);
    await this.sessions.appendMessage(session, { role: 'USER', kind: 'command', content: text });

    // A fresh message supersedes any parked plan (an explicit /confirm is the
    // only path that executes it).
    if (session.status === 'AWAITING_CONFIRMATION') {
      session = await this.sessions.clearPlan(session);
    }

    const intent = this.intent.parse(session, text);
    const tool = intent.targetTool ? this.registry.get(intent.targetTool) : undefined;
    if (!tool || !tool.interpret) {
      return this.rejected(session, 'no_tool', 'ما في أداة تقدر تنفّذ هذا الطلب.', text);
    }
    if (!this.canUseTool(tool, ctx)) {
      return this.rejected(session, 'insufficient_permission', 'ما عندك صلاحية لاستخدام هذه الأداة.', text);
    }

    await this.context.resolve(session, intent);

    const handle = this.makeHandle(session, tool.name);

    // Interpretation can throw — most importantly an LLMError from a tool's own
    // model call. Mirror confirm()'s discipline: return a CODED, user-facing
    // failure (never a raw English exception) AND write an audit row. The
    // frontend maps the LLM code → an Arabic message.
    let turn: ToolTurnResult;
    try {
      turn = await tool.interpret(ctx, handle, text);
    } catch (err) {
      const reason = err instanceof LLMError || err instanceof AppError ? err.code : 'tool_error';
      const message =
        err instanceof LLMError
          ? 'تعذّر تنفيذ الطلب عبر مزوّد الذكاء الاصطناعي، حاول مرة أخرى.'
          : 'تعذّر تنفيذ الطلب، حاول مرة أخرى.';
      await this.audit
        .record({
          sessionId: session.id, userId: principal.userId, toolName: tool.name,
          originalRequest: text, parsedIntent: intent, transactionResult: 'failed', failedReason: reason,
        })
        .catch((e) => logger.error({ err: e, sessionId: session.id }, 'platform audit(message-failed) write failed'));
      return this.rejected(session, reason, message, text);
    }

    if (turn.kind === 'rejected') {
      await this.audit.record({
        sessionId: session.id, userId: principal.userId, toolName: tool.name,
        originalRequest: text, parsedIntent: intent, transactionResult: 'not_required', failedReason: turn.reason,
      }).catch((e) => logger.error({ err: e, sessionId: session.id }, 'platform audit(rejected) write failed'));
      return this.rejected(session, turn.reason, turn.message, text);
    }
    if (turn.kind === 'clarification') {
      await this.sessions.appendMessage(session, { role: 'ASSISTANT', kind: 'clarification', content: turn.question, toolName: tool.name, confidence: turn.confidence });
      return { kind: 'clarification', sessionId: session.id, question: turn.question, missing: turn.missing, options: turn.options, confidence: turn.confidence };
    }
    if (turn.kind === 'query') {
      await this.sessions.appendMessage(session, { role: 'ASSISTANT', kind: 'query', content: turn.message, toolName: tool.name });
      return { kind: 'query', sessionId: session.id, toolName: tool.name, message: turn.message, data: turn.data };
    }

    // preview — confidence gate (the program, not the AI): combine the parser's
    // and the tool's confidence, and if we're too unsure to park a MUTATING plan,
    // ask the user to confirm intent instead of presenting a confident preview.
    const score = this.confidence.score({
      intent: intent.confidence,
      context: turn.confidence,
      catalogMatch: turn.confidence,
    });
    if (turn.requiresConfirmation && this.confidence.gate(score) === 'clarify') {
      const question = 'لست متأكداً بما يكفي لتنفيذ هذا الطلب. ممكن توضّح أكثر؟';
      await this.sessions.appendMessage(session, { role: 'ASSISTANT', kind: 'clarification', content: question, toolName: tool.name, confidence: score });
      return { kind: 'clarification', sessionId: session.id, question, missing: [], confidence: score };
    }

    await this.sessions.appendMessage(session, { role: 'ASSISTANT', kind: 'preview', content: turn.summary, toolName: tool.name, confidence: turn.confidence });
    if (turn.requiresConfirmation && turn.confirmStep) {
      const plan = this.planner.planConfirmation(turn.confirmStep, turn.summary, turn.confidence);
      session = await this.sessions.parkPlan(session, plan);
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
      return { kind: 'rejected', sessionId, reason: 'no_pending_plan', message: 'ما في خطة بانتظار التأكيد.' };
    }
    const toolName = session.activeTool;

    // Pre-validate BEFORE any write so a permission error does not fail the
    // session (the user can retry once permitted). Fail-closed.
    assertRegistered(plan, this.registry);
    assertPermitted(plan, ctx, this.registry);

    const handle = this.makeHandle(session, toolName ?? '');
    try {
      const result = await executePlan(this.prisma, this.registry, handle, plan, ctx);
      await this.sessions.complete(session);
      await this.sessions.appendMessage(session, { role: 'ASSISTANT', kind: 'execution', content: 'تم التنفيذ بنجاح.', toolName });
      await this.audit.record({
        sessionId, userId: principal.userId, toolName, originalRequest: session.title ?? '',
        plannerOutput: plan.steps, selectedTools: plan.steps.map((s) => s.action),
        userApproval: { confirmed: true }, executedActions: result.executedActions,
        finalData: result.result, transactionResult: 'executed', confidence: session.confidence,
        // The plan already committed; an audit failure here cannot roll it back,
        // but it must not be silent (an executed op with no trail is a hole).
      }).catch((e) => logger.error({ err: e, sessionId, userId: principal.userId }, 'platform audit(executed) write failed — trail incomplete'));
      return {
        kind: 'execution', sessionId, toolName, message: 'تم الحفظ بنجاح.',
        executedActions: result.executedActions, createdEntityIds: result.createdEntityIds, result: result.result,
      };
    } catch (err) {
      await this.sessions.markFailed(session).catch(() => {});
      const reason = err instanceof Error ? err.message : 'unknown_error';
      await this.audit.record({
        sessionId, userId: principal.userId, toolName, originalRequest: session.title ?? '',
        plannerOutput: plan.steps, transactionResult: 'failed', failedReason: reason,
      }).catch((e) => logger.error({ err: e, sessionId }, 'platform audit(failed) write failed'));
      throw err;
    }
  }

  async cancel(sessionId: string, principal: Principal): Promise<PlatformCancelResult> {
    const ctx = await this.buildContext(principal);
    const session = await this.sessions.load(sessionId, principal.userId, false);
    if (session.activeTool) {
      const tool = this.registry.get(session.activeTool);
      if (tool?.onCancel) await tool.onCancel(ctx, this.makeHandle(session, session.activeTool)).catch(() => {});
    }
    await this.sessions.cancel(session);
    await this.audit.record({
      sessionId, userId: principal.userId, toolName: session.activeTool, originalRequest: session.title ?? '',
      transactionResult: 'cancelled',
    }).catch(() => {});
    return { kind: 'cancelled', sessionId, message: 'تم إلغاء الجلسة.' };
  }

  // ===================== internals =====================

  private async buildContext(principal: Principal): Promise<PlatformContext> {
    // Live re-check (active + CURRENT role from DB) — see AccessService.liveUserRole.
    // A deactivated user is rejected; a role change takes effect within seconds.
    const role = await this.access.liveUserRole(principal.userId);
    const keys = await this.access.permissionsForRole(role);
    return { ...principal, role, permissions: new Set(keys), deps: buildToolDeps(this.prisma, this.injectedClient), rules: this.rules };
  }

  private canUseTool(tool: Tool | undefined, ctx: PlatformContext): boolean {
    if (!tool) return false;
    if (!tool.interpretPermissions || tool.interpretPermissions.length === 0) return true;
    return tool.interpretPermissions.every((p) => ctx.permissions.has(p));
  }

  /** A persistence-backed SessionHandle; setWorkingState mutates the in-memory
   *  row too so later reads in the same turn see the update. */
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

  private async rejected(session: AiSession, reason: string, message: string, _text: string): Promise<PlatformMessageResult> {
    await this.sessions.appendMessage(session, { role: 'ASSISTANT', kind: 'rejected', content: message }).catch(() => {});
    return { kind: 'rejected', sessionId: session.id, reason, message };
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
