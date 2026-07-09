// ============================================================
// CommandTool — the bridge that brings the legacy AI-command capability
// (clients / projects / contracts / payments / expenses / materials / reports)
// onto the unified platform, WITHOUT rewriting it. It mirrors EstimationTool's
// "wrap, don't rewrite" shape:
//
//   - interpret() reuses the extracted program pass (resolve refs → slots →
//     permissions → query|plan) over the same LLM contract, producing a platform
//     ToolTurnResult. Multi-turn context comes from the wired ConversationMemory
//     preamble (ctx.conversation) — NOT the legacy in-memory session.
//   - the single `command.execute` action delegates to ai-command's own
//     executePlan() UNCHANGED, so the proven transaction/permission/ref-threading
//     semantics are preserved. Per-step permissions are re-gated INSIDE executePlan
//     (the platform validator only sees the coarse `command.execute`, by design).
//
// Nothing here is registered as 41 separate actions: the registry only needs the
// one delegating action, and the capability list users see is a canned pre-router
// reply, not a registry dump.
// ============================================================

import { z } from 'zod';
import type { PlatformContext, SessionHandle, Tool, ToolAction } from '../../ai-platform/registry/tool.contract.js';
import type { ActionOutcome, ToolTurnResult } from '../../ai-platform/ai-platform.types.js';
import { parseInterpretation } from '../../ai-command-workflow/ai-command-workflow.arabic.js';
import {
  buildConfirmationMessage,
  buildQueryMessage,
  describeSteps,
  missingPermissions,
  missingSlots,
  resolveReferences,
  runQueries,
  slotLabels,
  slotQuestion,
} from '../../ai-command-workflow/ai-command-workflow.program.js';
import { getAction, isRegisteredAction } from '../../ai-command-workflow/ai-command-workflow.registry.js';
import { executePlan } from '../../ai-command-workflow/ai-command-workflow.executor.js';
import { buildSystemPrompt, buildUserPrompt } from '../../ai-command-workflow/ai-command-workflow.prompts.js';
import { LLM_INTERPRETATION_JSON_SCHEMA } from '../../ai-command-workflow/ai-command-workflow.schemas.js';
import type { ExecContext, LlmInterpretation, StoredPlan } from '../../ai-command-workflow/ai-command-workflow.types.js';

function toExecContext(ctx: PlatformContext): ExecContext {
  return { userId: ctx.userId, role: ctx.role, actor: ctx.actor, permissions: ctx.permissions };
}

/** Map a validated LLM interpretation onto a platform ToolTurnResult — the same
 *  decision flow as the legacy service's handleInterpretation, minus its session
 *  writes and its own audit (the orchestrator owns those now). */
async function mapInterpretation(
  parsed: LlmInterpretation,
  ctx: PlatformContext,
  text: string,
): Promise<ToolTurnResult> {
  const { deps, repo } = ctx.deps.command;

  if (parsed.kind === 'rejected') {
    return { kind: 'rejected', reason: 'not_understood', message: parsed.reason };
  }
  if (parsed.kind === 'clarification') {
    return { kind: 'clarification', question: parsed.question, missing: slotLabels(parsed.missingSlots ?? []), confidence: parsed.confidence ?? 0.8 };
  }

  // workflow_plan | query — both carry steps.
  const steps = parsed.steps;
  const intent = parsed.intent;
  const confidence = parsed.confidence ?? 0.8;

  const unregistered = steps.filter((s) => !isRegisteredAction(s.action));
  if (unregistered.length > 0) {
    return { kind: 'rejected', reason: 'unregistered_action', message: `النظام لا يدعم هذا الإجراء: ${unregistered.map((s) => s.action).join(', ')}` };
  }

  // The PROGRAM decides confirmation, not the AI's label.
  const hasMutation = steps.some((s) => getAction(s.action)?.kind === 'mutation');

  const resolved = await resolveReferences(repo, steps);
  if (resolved.reject) return { kind: 'rejected', reason: resolved.reject.reason, message: resolved.reject.message };
  if (resolved.clarify) {
    return { kind: 'clarification', question: resolved.clarify.message, missing: slotLabels(resolved.clarify.missingSlots), options: resolved.clarify.options, confidence };
  }
  const refs = resolved.refs;

  const missing = missingSlots(steps, refs);
  if (missing.length > 0) {
    return { kind: 'clarification', question: slotQuestion(missing), missing: slotLabels(missing), confidence };
  }

  const lacking = missingPermissions(steps, ctx.permissions);
  if (lacking.length > 0) {
    return { kind: 'rejected', reason: 'insufficient_permission', message: `لا تملك صلاحية تنفيذ هذا الأمر (${lacking.join('، ')}).` };
  }

  // Pure query → run now, no confirmation.
  if (!hasMutation) {
    const data = await runQueries(deps, toExecContext(ctx), steps, refs);
    return { kind: 'query', message: buildQueryMessage(intent), data };
  }

  // Mutation → a preview whose confirmStep parks the fully-resolved StoredPlan.
  const aiMessage = parsed.kind === 'workflow_plan' ? parsed.confirmationMessage : undefined;
  const confirmationMessage = await buildConfirmationMessage(deps, steps, refs, aiMessage);
  const stored: StoredPlan = { intent, confidence, steps, confirmationMessage, refs, originalText: text };
  return {
    kind: 'preview',
    summary: confirmationMessage,
    warnings: [],
    renderKind: 'command',
    // Display-only, and deliberately narrow: the plan itself (intent, steps,
    // resolved ids) stays server-side on the parked `confirmStep`. The screen
    // gets Arabic sentences, never the plan.
    payload: { lines: describeSteps(steps) },
    requiresConfirmation: true,
    // Trust the validated confidence so the platform's post-interpret gate does
    // not spuriously turn an accepted plan back into a clarification.
    confidence,
    confirmStep: { toolName: 'command', action: 'execute', input: { plan: stored } },
  };
}

async function interpret(ctx: PlatformContext, _session: SessionHandle, text: string): Promise<ToolTurnResult> {
  const { client } = await ctx.deps.command.resolveClient();
  if (!client) {
    return { kind: 'rejected', reason: 'llm_unavailable', message: 'المساعد الذكي غير مُفعّل. فعّل مزوّد الذكاء الاصطناعي من الإعدادات.' };
  }

  // Prior turns as context (the wired ConversationMemory preamble) so a follow-up
  // like "مساحته 250" completes the earlier intent — replaces the legacy
  // collectedSlots string-concat.
  const preamble = ctx.conversation?.preamble?.trim();
  const user = preamble ? `سياق المحادثة السابقة:\n${preamble}\n\nCommand: ${text}` : buildUserPrompt(text, {}, null);

  // Let an LLMError propagate — the orchestrator maps it to a friendly `error`.
  const raw = await client.complete({ system: buildSystemPrompt(), user, schema: LLM_INTERPRETATION_JSON_SCHEMA });

  const parsed = parseInterpretation(raw);
  if (!parsed) {
    return { kind: 'rejected', reason: 'invalid_ai_output', message: 'ما فهمت الطلب بوضوح، جرّب صياغة أوضح.' };
  }
  return mapInterpretation(parsed, ctx, text);
}

// The single delegating action. Real per-step permissions are enforced inside
// ai-command's executePlan (it re-runs assertPermitted on the actual steps), so
// this coarse action deliberately declares none.
const executeAction: ToolAction = {
  name: 'execute',
  kind: 'mutation',
  description: 'تنفيذ الأمر المُؤكَّد على السجلات (إنشاء/تعديل/حذف).',
  requiredPermissions: [],
  inputSchema: z.object({ plan: z.any() }),
  runStandalone: async (ctx, _session, input): Promise<ActionOutcome[]> => {
    const stored = input.plan as StoredPlan;
    const { deps } = ctx.deps.command;
    const out = await executePlan(deps.prisma, deps, stored, toExecContext(ctx));
    return out.executedActions.map((a) => ({ entity: a.entity, entityId: a.entityId, operation: a.operation }));
  },
};

export const CommandTool: Tool = {
  name: 'command',
  displayName: 'مساعد الأوامر',
  version: '1.0.0',
  permissionModule: 'ai',
  renderKind: 'command',
  actions: [executeAction],
  interpret,
  // Command's actions require existing domain permissions (customers.create, …),
  // already in the RBAC catalog — nothing new to contribute.
  contributePermissions: () => [],
};
