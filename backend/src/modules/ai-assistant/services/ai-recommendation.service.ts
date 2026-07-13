import type { AiRequestLog, Payment } from '@prisma/client';
import { ConflictError } from '../../../shared/errors/conflict.error.js';
import { NotFoundError } from '../../../shared/errors/not-found.error.js';
import { extractJsonObject } from '../../../lib/ai/extract-json.js';
import { formatMoney } from '../../../lib/docx/format-money.js';
import { money, round, toMoneyString, type Money } from '../../../lib/money.js';
import type {
  AiCompletionResult,
  AiProvider,
} from '../../../lib/ai/ai-provider.interface.js';
import type { AiRuntime } from '../../../lib/ai/ai-config.js';
import { requireUserId, type AuditActor, type AuditService } from '../../audit/audit.service.js';
import type { ReportsService } from '../../reports/reports.service.js';
import type { CostsService } from '../../costs/costs.service.js';
import type { PaymentsService } from '../../payments/payments.service.js';
import type { ChangeOrdersService } from '../../change-orders/change-orders.service.js';
import type { SettingsService } from '../../settings/settings.service.js';
import type { CreateCostInput } from '../../costs/costs.schemas.js';
import type { CreatePaymentInput } from '../../payments/payments.schemas.js';
import type { AiAssistantRepository } from '../ai-assistant.repository.js';
import {
  guardAiOutputSchema,
  recommendationEnrichmentSchema,
} from '../ai-assistant.schemas.js';
import type {
  ApplySuggestionResult,
  GuardResult,
  GuardWarning,
  RecommendationItem,
  RecommendationsResult,
} from '../ai-assistant.types.js';
import { buildSaveGuardMessages } from '../prompts/save-guard.js';
import {
  buildRecommendationsMessages,
  type AnonymizedFinding,
} from '../prompts/recommendations.js';

// Phase 4 — advisory layer only (Read + Suggest, no automatic writes):
//   - guards WARN about a draft cost/payment; they never block saving and the
//     modules' own programmatic validation stays authoritative;
//   - recommendations are DETERMINISTIC findings over public-service data,
//     optionally prioritised by the model (anonymized: no customer fields);
//   - the only mutation path is the EXPLICIT approval endpoint, which routes
//     through ChangeOrdersService's existing business rules (DRAFT only).

// Arabic tokenizes densely (~3 tokens/word): 250 truncated real outputs
// mid-JSON (seen live — the whole response was then rejected). 500 fits three
// 240-char warnings comfortably and stays cheap.
const GUARD_MAX_TOKENS = 500;
const ENRICH_MAX_TOKENS = 900;
const AI_TEMPERATURE = 0;
const OUTPUT_SUMMARY_LIMIT = 160;

// Deterministic thresholds (documented behavior, not tunable by the model).
const LARGE_COST_CONTRACT_RATIO = 0.25;
const LOW_MARGIN_RATIO = 0.1;
const SPEND_RATIO_THRESHOLD = 0.6;
const SPEND_PROGRESS_THRESHOLD = 40;
const DUPLICATE_WINDOW_DAYS = 7;
const MATERIAL_WINDOW_DAYS = 120;
const MATERIAL_RECENT_DAYS = 30;
const MATERIAL_RISE_RATIO = 1.15;
const MATERIAL_MIN_SAMPLES = 2;
/** Internal parameter (never user-facing): heavier analyses use the heavy model. */
const HEAVY_MODEL_FINDINGS_THRESHOLD = 5;

export interface AiRecommendationServiceDeps {
  runtime: AiRuntime;
  provider: AiProvider | null;
  repo: AiAssistantRepository;
  audit: AuditService;
  reports: ReportsService;
  costs: CostsService;
  payments: PaymentsService;
  changeOrders: ChangeOrdersService;
  settings: SettingsService;
}

export class AiRecommendationService {
  constructor(private readonly deps: AiRecommendationServiceDeps) {}

  // ============================================================
  // Save-guards — advisory, fail-open, never block
  // ============================================================

  async guardCost(input: CreateCostInput, actor: AuditActor): Promise<GuardResult> {
    const warnings: GuardWarning[] = [];
    const fmt = await this.moneyFormatter();
    const amount = resolveCostAmount(input);

    const profitability = await this.deps.reports.getProjectProfitability(input.projectId);
    if (amount && profitability.contractValue) {
      const contractValue = money(profitability.contractValue);
      const newTotal = money(profitability.totalCosts).plus(amount);
      if (newTotal.gt(contractValue)) {
        warnings.push(rule('COSTS_EXCEED_CONTRACT', 'warning',
          `إجمالي المصاريف بعد هذا القيد (${fmt(toMoneyString(newTotal))}) يتجاوز قيمة العقد (${fmt(profitability.contractValue)}).`));
      } else if (contractValue.gt(0) && amount.div(contractValue).gt(LARGE_COST_CONTRACT_RATIO)) {
        warnings.push(rule('LARGE_COST', 'warning',
          `قيمة هذا القيد وحده (${fmt(toMoneyString(amount))}) تتجاوز ربع قيمة العقد.`));
      }
    }

    if (amount) {
      const window = await this.deps.costs.list({
        page: 1,
        pageSize: 100,
        projectId: input.projectId,
        category: input.category,
        dateFrom: addDays(input.date, -DUPLICATE_WINDOW_DAYS),
        dateTo: addDays(input.date, DUPLICATE_WINDOW_DAYS),
        sortBy: 'date',
        sortDir: 'desc',
      });
      if (window.items.some((c) => money(c.totalAmount).eq(amount))) {
        warnings.push(rule('POSSIBLE_DUPLICATE_COST', 'warning',
          `يوجد قيد آخر بنفس القيمة والفئة خلال ${DUPLICATE_WINDOW_DAYS} أيام من هذا التاريخ — تأكد أنه ليس تكرارًا.`));
      }
    }

    const ai = await this.aiGuardLayer('cost', {
      category: input.category,
      description: input.description,
      unit: input.unit,
      quantity: input.quantity,
      unitPrice: input.unitPrice,
      totalAmount: input.totalAmount ?? (amount ? toMoneyString(amount) : null),
    }, input.projectId, actor);

    return { warnings: [...warnings, ...ai.warnings], aiChecked: ai.checked };
  }

  async guardPayment(input: CreatePaymentInput, actor: AuditActor): Promise<GuardResult> {
    const warnings: GuardWarning[] = [];
    const fmt = await this.moneyFormatter();
    const amount = money(input.amount);

    const profitability = await this.deps.reports.getProjectProfitability(input.projectId);
    const remaining =
      profitability.remainingBalance !== null ? money(profitability.remainingBalance) : null;
    if (remaining && amount.gt(remaining)) {
      warnings.push(rule('EXCEEDS_REMAINING_BALANCE', 'warning',
        `قيمة الدفعة (${fmt(toMoneyString(amount))}) تتجاوز الرصيد المتبقي على العقد (${fmt(profitability.remainingBalance)}).`));
    }

    const window = await this.deps.payments.list({
      page: 1,
      pageSize: 100,
      projectId: input.projectId,
      dueDateFrom: addDays(input.dueDate, -DUPLICATE_WINDOW_DAYS),
      dueDateTo: addDays(input.dueDate, DUPLICATE_WINDOW_DAYS),
      sortBy: 'dueDate',
      sortDir: 'asc',
    });
    if (window.items.some((p) => money(p.amount).eq(amount))) {
      warnings.push(rule('POSSIBLE_DUPLICATE_PAYMENT', 'warning',
        `توجد دفعة أخرى بنفس القيمة خلال ${DUPLICATE_WINDOW_DAYS} أيام من هذا الاستحقاق — تأكد أنها ليست تكرارًا.`));
    }
    if (input.reference) {
      const sameRef = await this.deps.payments.list({
        page: 1, pageSize: 20, projectId: input.projectId, search: input.reference,
        sortBy: 'createdAt', sortDir: 'desc',
      });
      if (sameRef.items.some((p) => p.reference === input.reference)) {
        warnings.push(rule('DUPLICATE_REFERENCE', 'warning',
          `المرجع "${input.reference}" مستخدم في دفعة أخرى لنفس المشروع.`));
      }
    }

    if (remaining && !warnings.some((w) => w.code === 'EXCEEDS_REMAINING_BALANCE')) {
      const pendingSum = sumPending(window.items);
      if (pendingSum.plus(amount).gt(remaining)) {
        warnings.push(rule('SCHEDULED_EXCEEDS_REMAINING', 'info',
          'مجموع الدفعات غير المسددة مع هذه الدفعة يتجاوز الرصيد المتبقي على العقد.'));
      }
    }

    const ai = await this.aiGuardLayer('payment', {
      amount: input.amount,
      dueDate: input.dueDate.toISOString().slice(0, 10),
      method: input.method,
      reference: input.reference,
      notes: input.notes,
    }, input.projectId, actor);

    return { warnings: [...warnings, ...ai.warnings], aiChecked: ai.checked };
  }

  // ============================================================
  // Recommendations — deterministic detectors + optional enrichment
  // ============================================================

  async listRecommendations(actor: AuditActor): Promise<RecommendationsResult> {
    const fmt = await this.moneyFormatter();
    const now = new Date();
    const [profitability, overdueGroups, materialWindow] = await Promise.all([
      this.deps.reports.listProjectProfitability({
        page: 1, pageSize: 100, sortBy: 'createdAt', sortDir: 'desc',
      }),
      this.deps.reports.getOverduePayments({}),
      this.deps.costs.list({
        page: 1, pageSize: 100, category: 'MATERIAL',
        dateFrom: addDays(now, -MATERIAL_WINDOW_DAYS),
        sortBy: 'date', sortDir: 'desc',
      }),
    ]);

    const items: RecommendationItem[] = [
      ...this.detectMarginFindings(profitability.items, fmt),
      ...detectRepeatLateCustomers(overdueGroups, fmt),
      ...detectMaterialPriceRises(materialWindow.items, now, fmt),
    ];

    await this.ensurePendingSuggestions(items, actor);
    const enrichment = await this.enrichWithAi(items, actor);

    items.sort(byUrgency);
    return {
      items,
      aiEnriched: enrichment.enriched,
      modelUsed: enrichment.modelUsed,
      generatedAt: new Date().toISOString(),
    };
  }

  // ============================================================
  // Suggestions — the ONLY mutation path, explicit + permission-gated
  // ============================================================

  async applySuggestion(id: string, actor: AuditActor): Promise<ApplySuggestionResult> {
    const suggestion = await this.requirePendingSuggestion(id);
    const [contractId, projectId] = suggestion.recordIds;
    if (!contractId || !projectId) {
      throw new ConflictError('الاقتراح غير مكتمل البيانات ولا يمكن تطبيقه.', 'SUGGESTION_MALFORMED');
    }

    // Recompute from CURRENT numbers — a days-old delta must never be applied.
    const profitability = await this.deps.reports.getProjectProfitability(projectId);
    const profit = profitability.profit !== null ? money(profitability.profit) : null;
    if (!profit || profit.gte(0)) {
      throw new ConflictError(
        'لم يعد الاقتراح واردًا — هامش المشروع لم يعد سالبًا بالأرقام الحالية.',
        'SUGGESTION_STALE',
      );
    }
    const fmt = await this.moneyFormatter();
    const delta = round(profit.abs());

    // Through the change-orders module's OWN business rules: contract must be
    // APPROVED, the result is a DRAFT that its approval flow governs, and the
    // module audits the creation itself.
    const changeOrder = await this.deps.changeOrders.create(
      {
        contractId,
        title: 'مراجعة تسعير مقترحة من المساعد الذكي',
        description:
          `هامش مشروع «${profitability.name}» سالب بواقع ${fmt(toMoneyString(delta))} بالأرقام الحالية. ` +
          'أمر التغيير مسودة بقيمة العجز كنقطة انطلاق — راجع المبلغ وعدّله قبل الاعتماد.',
        amount: delta.toNumber(),
      },
      actor,
    );

    const updated = await this.deps.repo.updateApprovalState(id, 'APPROVED');
    await this.deps.audit.log(actor, {
      action: 'UPDATE',
      entity: 'AiRequestLog',
      entityId: id,
      oldValues: { approvalState: 'PENDING' },
      newValues: { approvalState: 'APPROVED', changeOrderId: changeOrder.id, contractId },
    });

    return {
      suggestionId: id,
      approvalState: updated.approvalState,
      changeOrder: {
        id: changeOrder.id,
        number: changeOrder.number,
        amount: toMoneyString(money(changeOrder.amount)),
      },
    };
  }

  async rejectSuggestion(id: string, actor: AuditActor): Promise<{ suggestionId: string; approvalState: string }> {
    await this.requirePendingSuggestion(id);
    const updated = await this.deps.repo.updateApprovalState(id, 'REJECTED');
    await this.deps.audit.log(actor, {
      action: 'UPDATE',
      entity: 'AiRequestLog',
      entityId: id,
      oldValues: { approvalState: 'PENDING' },
      newValues: { approvalState: 'REJECTED' },
    });
    return { suggestionId: id, approvalState: updated.approvalState };
  }

  // ---------- private: detectors ----------

  private detectMarginFindings(
    rows: Awaited<ReturnType<ReportsService['listProjectProfitability']>>['items'],
    fmt: (v: string | null) => string,
  ): RecommendationItem[] {
    const findings: RecommendationItem[] = [];
    for (const row of rows) {
      if (row.status !== 'IN_PROGRESS' && row.status !== 'PAUSED') continue;
      if (!row.contractValue || !row.contractId) continue;
      const contractValue = money(row.contractValue);
      if (contractValue.lte(0)) continue;
      const profit = row.profit !== null ? money(row.profit) : null;

      const base = {
        projectId: row.projectId,
        projectName: row.name,
        contractId: row.contractId,
        contractNumber: row.contractNumber ?? undefined,
      };

      if (profit && profit.lt(0)) {
        findings.push({
          id: `NEGATIVE_MARGIN:${row.contractId}`,
          kind: 'NEGATIVE_MARGIN',
          severity: 'critical',
          title: `هامش سالب في «${row.name}»`,
          detail:
            `المصاريف (${fmt(row.totalCosts)}) تجاوزت قيمة العقد (${fmt(row.contractValue)}) ` +
            `بعجز ${fmt(toMoneyString(profit.abs()))} ونسبة إنجاز ${row.progressPercentage}%.`,
          applicable: true,
          ...base,
        });
      } else if (profit && profit.div(contractValue).lt(LOW_MARGIN_RATIO)) {
        findings.push({
          id: `LOW_MARGIN:${row.contractId}`,
          kind: 'LOW_MARGIN',
          severity: 'warning',
          title: `هامش منخفض في «${row.name}»`,
          detail: `الربح الحالي ${fmt(row.profit)} أقل من ${LOW_MARGIN_RATIO * 100}% من قيمة العقد (${fmt(row.contractValue)}).`,
          applicable: false,
          ...base,
        });
      }

      const spendRatio = money(row.totalCosts).div(contractValue);
      if (spendRatio.gte(SPEND_RATIO_THRESHOLD) && row.progressPercentage <= SPEND_PROGRESS_THRESHOLD) {
        findings.push({
          id: `SPEND_WITHOUT_PROGRESS:${row.projectId}`,
          kind: 'SPEND_WITHOUT_PROGRESS',
          severity: 'warning',
          title: `صرف دون تقدم متناسب في «${row.name}»`,
          detail:
            `استُهلك ${spendRatio.times(100).toFixed(0)}% من قيمة العقد مقابل إنجاز ${row.progressPercentage}% فقط.`,
          applicable: false,
          ...base,
        });
      }
    }
    return findings;
  }

  // ---------- private: suggestions ----------

  private async ensurePendingSuggestions(items: RecommendationItem[], actor: AuditActor): Promise<void> {
    for (const item of items) {
      if (!item.applicable || !item.contractId || !item.projectId) continue;
      const existing = await this.deps.repo.findPendingSuggestionByRecordId(item.contractId);
      if (existing) {
        item.suggestionId = existing.id;
        continue;
      }
      const row = await this.deps.repo.createRequestLog({
        userId: requireUserId(actor),
        operationType: 'RECOMMENDATION',
        // Suggestion rows are born from the deterministic detectors — no
        // model call is behind THIS row, and the label says so.
        modelUsed: 'rule-based',
        sourceModules: ['reports'],
        recordIds: [item.contractId, item.projectId],
        tokensPrompt: 0,
        tokensCompletion: 0,
        outputSummary: summarize(
          `suggestion: draft change-order for ${item.contractNumber ?? item.contractId} (negative margin)`,
        ),
        approvalState: 'PENDING',
      });
      await this.deps.audit.log(actor, {
        action: 'CREATE',
        entity: 'AiRequestLog',
        entityId: row.id,
        newValues: {
          operationType: 'RECOMMENDATION',
          approvalState: 'PENDING',
          kind: item.kind,
          contractId: item.contractId,
          projectId: item.projectId,
        },
      });
      item.suggestionId = row.id;
    }
  }

  private async requirePendingSuggestion(id: string): Promise<AiRequestLog> {
    const row = await this.deps.repo.findRequestLogById(id);
    if (!row || row.operationType !== 'RECOMMENDATION') {
      throw new NotFoundError('Suggestion', 'SUGGESTION_NOT_FOUND');
    }
    if (row.approvalState !== 'PENDING') {
      throw new ConflictError('الاقتراح ليس بانتظار الموافقة.', 'SUGGESTION_NOT_PENDING');
    }
    return row;
  }

  // ---------- private: AI layers (advisory, fail-open) ----------

  private async aiGuardLayer(
    entity: 'cost' | 'payment',
    payload: Record<string, unknown>,
    projectId: string,
    actor: AuditActor,
  ): Promise<{ warnings: GuardWarning[]; checked: boolean }> {
    const { runtime, provider } = this.deps;
    if (!runtime.enabled || !provider) return { warnings: [], checked: false };

    let completion: AiCompletionResult;
    try {
      completion = await provider.complete({
        model: runtime.config.modelDefault,
        messages: buildSaveGuardMessages(entity, payload),
        responseFormat: 'json_object',
        temperature: AI_TEMPERATURE,
        maxTokens: GUARD_MAX_TOKENS,
      });
    } catch {
      // Provider unreachable — the guard is advisory; rules already ran.
      return { warnings: [], checked: false };
    }

    const sourceModules = [entity === 'cost' ? 'costs' : 'payments'];
    const parsed = safeParseJson(completion.content, guardAiOutputSchema);
    if (!parsed) {
      await this.safeLogGovernance(actor, {
        operationType: 'SAVE_GUARD', completion, sourceModules,
        recordIds: [projectId], outputSummary: 'guard rejected: bad model output',
      });
      return { warnings: [], checked: false };
    }

    await this.safeLogGovernance(actor, {
      operationType: 'SAVE_GUARD', completion, sourceModules,
      recordIds: [projectId],
      outputSummary: `guard(${entity}): ${parsed.warnings.length} ai warnings`,
    });
    return {
      checked: true,
      warnings: parsed.warnings.map((w) => ({ ...w, source: 'ai' as const })),
    };
  }

  private async enrichWithAi(
    items: RecommendationItem[],
    actor: AuditActor,
  ): Promise<{ enriched: boolean; modelUsed?: string }> {
    const { runtime, provider } = this.deps;
    if (items.length === 0 || !runtime.enabled || !provider) return { enriched: false };

    // Internal heavy-model switch — never exposed to the caller.
    const model =
      items.length >= HEAVY_MODEL_FINDINGS_THRESHOLD
        ? runtime.config.modelHeavy
        : runtime.config.modelDefault;
    const currency = await this.deps.settings.getDefaultCurrency();
    const currencyLabel = currency ? `${currency.symbol} (${currency.code})` : '';

    let completion: AiCompletionResult;
    try {
      completion = await provider.complete({
        model,
        messages: buildRecommendationsMessages(anonymizeFindings(items), currencyLabel),
        responseFormat: 'json_object',
        temperature: AI_TEMPERATURE,
        maxTokens: ENRICH_MAX_TOKENS,
      });
    } catch {
      return { enriched: false };
    }

    const parsed = safeParseJson(completion.content, recommendationEnrichmentSchema);
    if (!parsed) {
      await this.safeLogGovernance(actor, {
        operationType: 'RECOMMENDATION', completion, sourceModules: ['reports', 'costs', 'payments'],
        recordIds: [], outputSummary: 'enrichment rejected: bad model output',
      });
      return { enriched: false };
    }

    const byId = new Map(items.map((i) => [i.id, i]));
    let matched = 0;
    for (const entry of parsed.items) {
      const target = byId.get(entry.id);
      if (!target) continue; // Unknown id — the model invented it; ignore.
      target.aiPriority = entry.priority;
      target.aiAdvice = entry.advice;
      matched += 1;
    }

    await this.safeLogGovernance(actor, {
      operationType: 'RECOMMENDATION', completion, sourceModules: ['reports', 'costs', 'payments'],
      recordIds: [],
      outputSummary: `recommendations: ${items.length} findings, ${matched} enriched`,
    });
    return { enriched: true, modelUsed: completion.modelUsed };
  }

  // ---------- private: helpers ----------

  private async moneyFormatter(): Promise<(v: string | null) => string> {
    const currency = await this.deps.settings.getDefaultCurrency();
    return (v) => (v === null ? '—' : formatMoney(v, { currency }));
  }

  private async safeLogGovernance(
    actor: AuditActor,
    input: {
      operationType: 'SAVE_GUARD' | 'RECOMMENDATION';
      completion: AiCompletionResult;
      sourceModules: string[];
      recordIds: string[];
      outputSummary: string;
    },
  ): Promise<void> {
    try {
      const log = await this.deps.repo.createRequestLog({
        userId: requireUserId(actor),
        operationType: input.operationType,
        modelUsed: input.completion.modelUsed,
        sourceModules: input.sourceModules,
        recordIds: input.recordIds,
        tokensPrompt: input.completion.usage.promptTokens,
        tokensCompletion: input.completion.usage.completionTokens,
        outputSummary: input.outputSummary,
      });
      await this.deps.audit.log(actor, {
        action: 'CREATE',
        entity: 'AiRequestLog',
        entityId: log.id,
        newValues: {
          operationType: input.operationType,
          modelUsed: input.completion.modelUsed,
          tokensPrompt: input.completion.usage.promptTokens,
          tokensCompletion: input.completion.usage.completionTokens,
          outputSummary: input.outputSummary,
        },
      });
    } catch {
      // Governance write failed — advisory flows still answer; the primary
      // path must not break on a logging hiccup.
    }
  }
}

// ---------- module-level pure helpers ----------

function rule(code: string, severity: GuardWarning['severity'], message: string): GuardWarning {
  return { code, severity, source: 'rule', message };
}

function resolveCostAmount(input: CreateCostInput): Money | null {
  if (input.quantity !== null && input.unitPrice !== null) {
    return round(money(input.quantity).times(money(input.unitPrice)));
  }
  if (input.totalAmount !== undefined) return round(money(input.totalAmount));
  return null;
}

function sumPending(payments: Payment[]): Money {
  return payments
    .filter((p) => p.status === 'PENDING' || p.status === 'LATE')
    .reduce((acc, p) => acc.plus(money(p.amount)), money(0));
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function safeParseJson<T>(raw: string, schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } }): T | null {
  try {
    const parsed: unknown = JSON.parse(extractJsonObject(raw));
    const result = schema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** Model-facing findings: numbers + project names only — never customer fields. */
function anonymizeFindings(items: RecommendationItem[]): AnonymizedFinding[] {
  return items.map((item) => ({
    id: item.id,
    kind: item.kind,
    metrics: {
      ...(item.projectName ? { project: item.projectName } : {}),
      detail: item.detail,
      severity: item.severity,
    },
  }));
}

const SEVERITY_ORDER: Record<RecommendationItem['severity'], number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

function byUrgency(a: RecommendationItem, b: RecommendationItem): number {
  const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  if (bySeverity !== 0) return bySeverity;
  return (b.aiPriority ?? 0) - (a.aiPriority ?? 0);
}

function detectRepeatLateCustomers(
  groups: Awaited<ReturnType<ReportsService['getOverduePayments']>>,
  fmt: (v: string | null) => string,
): RecommendationItem[] {
  const byCustomer = new Map<
    string,
    { name: string | null; projects: Set<string>; payments: number; total: Money }
  >();
  for (const group of groups) {
    if (!group.customerId) continue;
    const entry = byCustomer.get(group.customerId) ?? {
      name: group.customerName,
      projects: new Set<string>(),
      payments: 0,
      total: money(0),
    };
    entry.projects.add(group.projectId);
    entry.payments += group.overduePaymentsCount;
    entry.total = entry.total.plus(money(group.totalOverdueAmount));
    byCustomer.set(group.customerId, entry);
  }

  const findings: RecommendationItem[] = [];
  for (const [customerId, entry] of byCustomer) {
    if (entry.payments < 3 && entry.projects.size < 2) continue;
    findings.push({
      id: `REPEAT_LATE_CUSTOMER:${customerId}`,
      kind: 'REPEAT_LATE_CUSTOMER',
      severity: 'warning',
      title: `تأخر سداد متكرر — ${entry.name ?? 'عميل'}`,
      detail:
        `${entry.payments} دفعات متأخرة عبر ${entry.projects.size} مشروع بإجمالي ${fmt(toMoneyString(entry.total))}. ` +
        'يُستحسن ترتيب موقف التحصيل قبل جدولة دفعات جديدة.',
      customerId,
      customerName: entry.name ?? undefined,
      applicable: false,
    });
  }
  return findings;
}

function detectMaterialPriceRises(
  rows: Awaited<ReturnType<CostsService['list']>>['items'],
  now: Date,
  fmt: (v: string | null) => string,
): RecommendationItem[] {
  const recentCutoff = addDays(now, -MATERIAL_RECENT_DAYS);
  const byMaterial = new Map<
    string,
    { name: string; recent: Money[]; prior: Money[] }
  >();
  for (const row of rows) {
    if (!row.materialId || !row.material || row.unitPrice === null) continue;
    const entry = byMaterial.get(row.materialId) ?? {
      name: row.material.name,
      recent: [],
      prior: [],
    };
    (row.date >= recentCutoff ? entry.recent : entry.prior).push(money(row.unitPrice));
    byMaterial.set(row.materialId, entry);
  }

  const findings: RecommendationItem[] = [];
  for (const [materialId, entry] of byMaterial) {
    if (entry.recent.length < MATERIAL_MIN_SAMPLES || entry.prior.length < MATERIAL_MIN_SAMPLES) {
      continue;
    }
    const avgRecent = average(entry.recent);
    const avgPrior = average(entry.prior);
    if (avgPrior.lte(0) || avgRecent.lt(avgPrior.times(MATERIAL_RISE_RATIO))) continue;
    const risePct = avgRecent.div(avgPrior).minus(1).times(100).toFixed(0);
    findings.push({
      id: `MATERIAL_PRICE_RISE:${materialId}`,
      kind: 'MATERIAL_PRICE_RISE',
      severity: 'warning',
      title: `ارتفاع سعر مادة «${entry.name}»`,
      detail:
        `متوسط سعر الشراء خلال ${MATERIAL_RECENT_DAYS} يومًا (${fmt(toMoneyString(round(avgRecent)))}) ` +
        `أعلى بنحو ${risePct}% من متوسط الفترة السابقة (${fmt(toMoneyString(round(avgPrior)))}).`,
      materialId,
      materialName: entry.name,
      applicable: false,
    });
  }
  return findings;
}

function average(values: Money[]): Money {
  return values.reduce((acc, v) => acc.plus(v), money(0)).div(values.length);
}

function summarize(text: string): string {
  return text.length <= OUTPUT_SUMMARY_LIMIT ? text : `${text.slice(0, OUTPUT_SUMMARY_LIMIT - 1)}…`;
}
