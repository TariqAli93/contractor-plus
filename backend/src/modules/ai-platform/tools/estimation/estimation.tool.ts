// ============================================================
// EstimationTool — the first Tool on the platform. It owns NO AI infrastructure;
// it wraps the existing, proven EstimationTemplatesService (Phase 1: delegate,
// don't rewrite — so the 38 estimation tests stay green). Its NL entry reuses the
// service's own LLM call (one call per turn); its `confirm` action delegates to
// the service's own all-or-nothing confirm transaction via the executor's
// single-mutation `runStandalone` path. Its deterministic rules are the re-homed
// calc.ts functions.
// ============================================================

import { z } from 'zod';
import { CostCategory } from '@prisma/client';
import { ConflictError } from '../../../../shared/errors/conflict.error.js';
import { REVIEW_WARNING } from '../../../estimation-templates/estimation-templates.service.js';
import { recomputeDraft, computeWasteAmount } from '../../../estimation-templates/estimation-templates.calc.js';
import type { EstimationDraftItemPayload } from '../../../estimation-templates/estimation-templates.types.js';
import { money, sumMoney, toMoneyString, type Money } from '../../../../lib/money.js';
import type { RuleFn } from '../../rules/rule-engine.js';
import type { PlatformContext, SessionHandle, Tool, ToolAction } from '../../registry/tool.contract.js';
import type { ToolTurnResult } from '../../ai-platform.types.js';
import { ESTIMATION_PERMISSIONS } from './estimation.permissions.js';

interface EstimationWorkingState {
  draftId: string;
  status: string;
}

function principalOf(ctx: PlatformContext) {
  return { userId: ctx.userId, role: ctx.role, actor: ctx.actor };
}
function readState(session: SessionHandle): EstimationWorkingState | null {
  return (session.workingState as EstimationWorkingState | null) ?? null;
}

// --- user-facing summary ------------------------------------------------------
// The preview's headline is read by a contractor, not by a developer: it restates
// the request in Arabic. Machine vocabulary (unit codes, English project types
// from older drafts) is translated on the way out, never shown raw.
const UNIT_LABELS_AR: Record<string, string> = { m2: 'متر مربع', 'm²': 'متر مربع', m: 'متر', ml: 'متر طولي' };
const PROJECT_TYPE_AR: Record<string, string> = {
  structural: 'هيكل',
  finishing: 'تشطيب',
  residential: 'سكني',
  commercial: 'تجاري',
  plumbing: 'سباكة',
  electrical: 'كهرباء',
  fence: 'سياج',
};

function summarize(projectType: string | null, areaValue: string | null, areaUnit: string | null): string {
  const lines = ['تم التعرف على الطلب: إنشاء قالب تقدير.'];
  if (projectType) lines.push(`نوع المشروع: ${PROJECT_TYPE_AR[projectType.toLowerCase()] ?? projectType}`);
  if (areaValue) {
    const unit = areaUnit ? UNIT_LABELS_AR[areaUnit.toLowerCase()] ?? areaUnit : '';
    lines.push(`المساحة: ${areaValue} ${unit}`.trim());
  }
  return lines.join('\n');
}

// --- deterministic rules (re-homed calc.ts), registered into the rule engine.
// RuleFn is (unknown)->unknown by contract; each rule narrows its own input. ---
const estimationRules: RuleFn[] = [
  {
    id: 'estimation.recompute',
    run: (i) => {
      const a = i as { items: EstimationDraftItemPayload[]; area: number | string | null; wastePct: number | string };
      return recomputeDraft(a.items, a.area, a.wastePct);
    },
  },
  {
    id: 'estimation.wasteAmount',
    run: (i) => {
      const a = i as { materialSubtotal: Money; wastePercentage: Money };
      return computeWasteAmount(a.materialSubtotal, a.wastePercentage);
    },
  },
];

// --- confirm action (mutation): delegates to the service's own tx ------------
const confirmAction: ToolAction = {
  name: 'confirm',
  kind: 'mutation',
  description: 'حفظ التقدير المُراجَع كقالب (وإنشاء أي مواد مُوافق عليها).',
  requiredPermissions: ['estimation_templates.ai_generate', 'estimation_templates.create'],
  inputSchema: z.object({ templateName: z.string().trim().min(1).max(200) }),
  // Single mutation → its own transaction (the service opens it). Mirrors the
  // ai-command executor's runStandalone path.
  runStandalone: async (ctx, session, input) => {
    const state = readState(session);
    if (!state?.draftId) throw new ConflictError('No estimation draft to confirm', 'NO_DRAFT');
    const templateName = String(input.templateName ?? '').trim();
    const result = await ctx.deps.estimation.confirmDraft(state.draftId, templateName, principalOf(ctx));
    return { entity: 'EstimationTemplate', entityId: result.templateId, operation: 'create', refKey: 'template', data: result };
  },
};

// --- NL entry: generate / refine via the existing service --------------------
async function interpret(ctx: PlatformContext, session: SessionHandle, text: string): Promise<ToolTurnResult> {
  const state = readState(session);
  const res = await ctx.deps.estimation.generateDraft(text, state?.draftId, principalOf(ctx));

  if (res.kind === 'rejected') {
    return { kind: 'rejected', reason: res.reason, message: res.message };
  }
  if (res.kind === 'clarification') {
    await session.setWorkingState({ draftId: res.draftId, status: res.status } satisfies EstimationWorkingState);
    return { kind: 'clarification', question: res.question, missing: res.missingFields, confidence: res.confidence };
  }

  // draft_ready
  await session.setWorkingState({ draftId: res.draftId, status: res.status } satisfies EstimationWorkingState);
  const ready = res.status === 'READY_FOR_CONFIRMATION';

  // Deterministic money math runs through the Business Rules Engine (never the
  // AI): derive the authoritative material-waste figure for the preview from the
  // material-line subtotal, so the console can show it without re-deriving math.
  const materialSubtotal = sumMoney(
    res.items.filter((it) => it.category === CostCategory.MATERIAL).map((it) => it.totalAmount),
  );
  const wasteAmount = ctx.rules.run<{ materialSubtotal: Money; wastePercentage: Money }, Money>(
    'estimation.wasteAmount',
    { materialSubtotal, wastePercentage: money(res.wastePercentage) },
  );

  return {
    kind: 'preview',
    summary: summarize(res.projectType, res.areaValue, res.areaUnit),
    warnings: [REVIEW_WARNING],
    renderKind: 'estimation',
    payload: {
      draftId: res.draftId,
      templateName: res.templateName,
      status: res.status,
      projectType: res.projectType,
      areaValue: res.areaValue,
      areaUnit: res.areaUnit,
      wastePercentage: res.wastePercentage,
      wasteAmount: toMoneyString(wasteAmount, 2),
      estimatedTotal: res.estimatedTotal,
      warning: REVIEW_WARNING,
      items: res.items,
    },
    requiresConfirmation: ready,
    confidence: res.confidence,
    confirmStep: ready
      ? { toolName: 'estimation', action: 'confirm', input: { templateName: res.templateName } }
      : undefined,
  };
}

export const EstimationTool: Tool = {
  name: 'estimation',
  displayName: 'مولّد قوالب التقدير الذكي',
  version: '1.0.0',
  permissionModule: 'estimation_templates',
  renderKind: 'estimation',
  interpretPermissions: ['estimation_templates.ai_generate'],
  rules: estimationRules,
  actions: [confirmAction],
  interpret,
  onCancel: async (ctx, session) => {
    const state = readState(session);
    if (state?.draftId) {
      try {
        await ctx.deps.estimation.cancelDraft(state.draftId, principalOf(ctx));
      } catch {
        /* best-effort — the draft may already be terminal */
      }
    }
  },
  contributePermissions: () => ESTIMATION_PERMISSIONS,
};
