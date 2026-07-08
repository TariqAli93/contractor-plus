// ============================================================
// Service — the orchestration brain of the AI Smart Estimation Template Builder.
//
// Linear, durable-draft lifecycle (NOT ai-command-workflow's in-memory turn):
//   generate → (clarify | refine) → resolve materials → preview → confirm.
// The AI only proposes (intent + per-material ratios); THIS layer computes every
// quantity/total via estimation-templates.calc.ts, resolves materials read-only,
// stages create/skip decisions in the durable draft, and performs ALL real
// writes inside ONE transaction at confirm — creating materials via the existing
// MaterialsService.createWithinTx and auditing via the existing AuditService.
// ============================================================

import type { PrismaClient, Prisma, EstimationTemplateDraft, EstimationTemplate } from '@prisma/client';
import { CostCategory } from '@prisma/client';
import { MaterialsService } from '../materials/materials.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AccessService } from '../rbac/access.service.js';
import { EstimationTemplatesRepository } from './estimation-templates.repository.js';
import { recomputeDraft } from './estimation-templates.calc.js';
import {
  buildEstimationSystemPrompt,
  buildGenerateUserPrompt,
  buildClarifyUserPrompt,
  buildRefineUserPrompt,
} from './estimation-templates.prompts.js';
import { llmEstimationOutputSchema } from './estimation-templates.schemas.js';
import { LlmSettingsStore } from '../../lib/llm/llm-settings.store.js';
import { createLlmClient, LLMError, type LlmClient } from '../../lib/llm/llm-client.js';
import { llmErrorMessageAr } from '../../lib/llm/llm-error-messages.js';
import type { LlmProviderName } from '../../lib/llm/llm.config.js';
import { toMoneyString, toMoneyStringOrNull } from '../../lib/money.js';
import { toJsonValue } from '../../shared/utils/json.js';
import { NotFoundError } from '../../shared/errors/not-found.error.js';
import { ConflictError } from '../../shared/errors/conflict.error.js';
import { ForbiddenError } from '../../shared/errors/forbidden.error.js';
import { buildPaginated, toSkipTake } from '../../shared/utils/pagination.js';
import type { Paginated } from '../../shared/types/pagination.js';
import { logger } from '../../lib/logger.js';
import type {
  EstimationGenerateResult,
  EstimationDraftResult,
  EstimationClarificationResult,
  EstimationDraftItem,
  EstimationPreview,
  EstimationConfirmResult,
  EstimationCancelResult,
  EstimationTemplateView,
  EstimationTemplateItemView,
  EstimationMaterialDecision,
} from '@contractor-plus/shared';
import type {
  Principal,
  EstimationContext,
  EstimationDraftItemPayload,
  LlmEstimationOutput,
  ParsedIntent,
} from './estimation-templates.types.js';
import type {
  ListEstimationTemplatesQuery,
  UpdateEstimationTemplateBody,
} from './estimation-templates.schemas.js';
import { LLM_ESTIMATION_JSON_SCHEMA } from './estimation-templates.schemas.js';

/** Mandatory reviewer warning — server-supplied so the copy can never drift. */
export const REVIEW_WARNING =
  'هذا التقدير تقريبي ويجب مراجعته من قبل مهندس قبل استخدامه للتنفيذ أو الشراء.';

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000; // 24h; lazy-expiry-on-read
const DEFAULT_MATERIAL_UNIT = 'وحدة';

export class EstimationTemplatesService {
  private readonly repo: EstimationTemplatesRepository;
  private readonly materials: MaterialsService;
  private readonly audit: AuditService;
  private readonly access: AccessService;
  private readonly llmSettings: LlmSettingsStore;

  constructor(
    private readonly prisma: PrismaClient,
    /** Injected for tests; production resolves a client from LLM settings. */
    private readonly injectedClient?: LlmClient,
  ) {
    this.repo = new EstimationTemplatesRepository(prisma);
    this.materials = new MaterialsService(prisma);
    this.audit = new AuditService(prisma);
    this.access = new AccessService(prisma);
    this.llmSettings = new LlmSettingsStore(prisma);
  }

  // ===================== GENERATE / CLARIFY / REFINE =====================

  async generateDraft(
    command: string,
    draftId: string | undefined,
    principal: Principal,
  ): Promise<EstimationGenerateResult> {
    // Continue an existing draft: answer a clarification, or refine the items.
    if (draftId) {
      const draft = await this.loadOwnedActiveDraft(draftId, principal);
      return this.continueDraft(draft, command, principal);
    }

    // Fresh generation — call the LLM first; only persist a draft if it succeeds
    // (a failed LLM call leaves no orphan draft row).
    const llm = await this.resolveClient();
    if (!llm.client) {
      return this.rejected(null, 'llm_unavailable', 'المساعد الذكي غير مُفعّل. فعّله من الإعدادات.');
    }
    const output = await this.interpret(llm.client, buildGenerateUserPrompt(command));
    if (!output.ok) return this.rejected(null, output.reason, output.message);

    return this.persistFromLlm(null, command, output.value, principal, llm.provider, 'draft_generated');
  }

  private async continueDraft(
    draft: EstimationTemplateDraft,
    command: string,
    principal: Principal,
  ): Promise<EstimationGenerateResult> {
    const llm = await this.resolveClient();
    if (!llm.client) {
      return this.rejected(draft.id, 'llm_unavailable', 'المساعد الذكي غير مُفعّل. فعّله من الإعدادات.');
    }

    const isClarifying = draft.status === 'CLARIFICATION_NEEDED';
    let prompt: string;
    if (isClarifying) {
      const priorQA = (draft.clarificationLog as Array<{ question: string; answer: string }> | null) ?? [];
      prompt = buildClarifyUserPrompt(draft.originalCommand, priorQA, command);
    } else if (
      draft.status === 'DRAFT_GENERATED' ||
      draft.status === 'MATERIALS_PENDING' ||
      draft.status === 'READY_FOR_CONFIRMATION'
    ) {
      prompt = buildRefineUserPrompt(draft.originalCommand, this.readIntent(draft), this.readItems(draft), command);
    } else {
      throw new ConflictError('Draft is not editable', 'DRAFT_NOT_EDITABLE');
    }

    const output = await this.interpret(llm.client, prompt);
    if (!output.ok) return this.rejected(draft.id, output.reason, output.message);

    return this.persistFromLlm(
      draft,
      draft.originalCommand,
      output.value,
      principal,
      llm.provider,
      isClarifying ? 'draft_generated' : 'draft_refined',
      isClarifying ? command : undefined,
    );
  }

  /** Turn a validated LLM output into a persisted draft (clarification or draft). */
  private async persistFromLlm(
    existing: EstimationTemplateDraft | null,
    originalCommand: string,
    output: LlmEstimationOutput,
    principal: Principal,
    provider: LlmProviderName | null,
    auditEvent: 'draft_generated' | 'draft_refined',
    clarificationAnswer?: string,
  ): Promise<EstimationGenerateResult> {
    const expiresAt = new Date(Date.now() + DRAFT_TTL_MS);

    if (output.kind === 'clarification') {
      const priorQA = (existing?.clarificationLog as Array<{ question: string; answer: string }> | null) ?? [];
      const nextQA =
        clarificationAnswer !== undefined && priorQA.length
          ? [...priorQA.slice(0, -1), { ...priorQA[priorQA.length - 1]!, answer: clarificationAnswer }, { question: output.question, answer: '' }]
          : [...priorQA, { question: output.question, answer: '' }];

      const draft = existing
        ? await this.repo.updateDraft(existing.id, {
            status: 'CLARIFICATION_NEEDED',
            confidence: output.confidence,
            clarificationLog: toJsonValue(nextQA),
            expiresAt,
          })
        : await this.repo.createDraft({
            userId: principal.userId,
            status: 'CLARIFICATION_NEEDED',
            originalCommand,
            confidence: output.confidence,
            clarificationLog: toJsonValue(nextQA),
            generatedItems: toJsonValue([]),
            expiresAt,
          });

      return this.toClarification(draft, output.question, output.missingFields);
    }

    // kind === 'draft'
    const items = await this.resolveMaterialsAgainstCatalog(this.llmDraftToItems(output));
    const waste = output.wastePercentage;
    const { items: computed, total } = recomputeDraft(items, output.intent.areaValue, waste);
    const status = this.computeStatus(computed);
    const templateName = output.intent.templateName ?? existing?.templateName ?? this.fallbackName(output);

    const data = {
      status,
      originalCommand,
      projectType: output.intent.projectType,
      constructionType: output.intent.constructionType,
      scopeOfWork: output.intent.scopeOfWork,
      areaValue: output.intent.areaValue,
      areaUnit: output.intent.areaUnit,
      wastePercentage: waste,
      templateName,
      confidence: output.confidence,
      generatedItems: toJsonValue(computed),
      estimatedTotal: total,
      expiresAt,
    };

    const draft = existing
      ? await this.repo.updateDraft(existing.id, data)
      : await this.repo.createDraft({ userId: principal.userId, ...data });

    await this.safeLog({
      draftId: draft.id,
      userId: principal.userId,
      eventType: auditEvent,
      originalCommand,
      parsedIntent: this.readIntent(draft),
      generatedEstimation: computed,
      ipAddress: principal.actor.ipAddress ?? null,
      userAgent: principal.actor.userAgent ?? null,
    });

    return this.toDraftResult(draft, computed);
  }

  // ===================== RESOLVE MATERIALS =====================

  async resolveMaterialDecisions(
    draftId: string,
    decisions: EstimationMaterialDecision[],
    principal: Principal,
  ): Promise<EstimationDraftResult> {
    const ctx = await this.buildContext(principal);
    const draft = await this.loadOwnedActiveDraft(draftId, principal);
    if (draft.status !== 'MATERIALS_PENDING') {
      throw new ConflictError('Draft has no materials pending resolution', 'DRAFT_NOT_PENDING');
    }

    // Fail closed BEFORE mutating: creating a material from the assistant needs
    // its own permission (distinct from plain materials.create). Skipping never does.
    const wantsCreate = decisions.some((d) => d.decision === 'approve_create');
    if (wantsCreate && !ctx.permissions.has('materials.create_from_assistant')) {
      throw new ForbiddenError('Not allowed to create materials via the assistant', 'INSUFFICIENT_PERMISSION');
    }

    const items = this.readItems(draft);
    const byId = new Map(items.map((it) => [it.tempId, it]));
    for (const decision of decisions) {
      const item = byId.get(decision.tempId);
      if (!item || item.resolutionStatus !== 'PENDING_APPROVAL') continue;
      if (decision.decision === 'approve_create') {
        item.resolutionStatus = 'APPROVED_CREATE';
        if (decision.unit) item.unit = decision.unit;
        if (decision.defaultPrice !== undefined) item.unitPrice = toMoneyString(decision.defaultPrice, 2);
      } else {
        item.resolutionStatus = 'SKIPPED';
      }
    }

    const { items: computed, total } = recomputeDraft(items, toMoneyStringOrNull(draft.areaValue, 3), draft.wastePercentage.toString());
    const status = this.computeStatus(computed);
    const saved = await this.repo.updateDraft(draft.id, {
      status,
      generatedItems: toJsonValue(computed),
      estimatedTotal: total,
      expiresAt: new Date(Date.now() + DRAFT_TTL_MS),
    });

    await this.safeLog({
      draftId: draft.id,
      userId: principal.userId,
      eventType: 'materials_resolved',
      originalCommand: draft.originalCommand,
      userApproval: decisions,
      generatedEstimation: computed,
      ipAddress: principal.actor.ipAddress ?? null,
      userAgent: principal.actor.userAgent ?? null,
    });

    return this.toDraftResult(saved, computed);
  }

  // ===================== MANUAL EDITS =====================

  async updateDraftItem(
    draftId: string,
    tempId: string,
    patch: { quantity?: number; unitPrice?: number; description?: string; unit?: string },
    principal: Principal,
  ): Promise<EstimationDraftResult> {
    const draft = await this.loadOwnedEditableDraft(draftId, principal);
    const items = this.readItems(draft);
    const item = items.find((it) => it.tempId === tempId);
    if (!item) throw new NotFoundError('Draft item', 'DRAFT_ITEM_NOT_FOUND');

    if (patch.quantity !== undefined) item.quantity = toMoneyString(patch.quantity, 3);
    if (patch.unitPrice !== undefined) item.unitPrice = toMoneyString(patch.unitPrice, 2);
    if (patch.description !== undefined) item.description = patch.description;
    if (patch.unit !== undefined) item.unit = patch.unit;
    // Once a human touches a line, its ratio is never re-applied to it.
    item.userEdited = true;

    const { items: computed, total } = recomputeDraft(items, toMoneyStringOrNull(draft.areaValue, 3), draft.wastePercentage.toString());
    const saved = await this.repo.updateDraft(draft.id, {
      generatedItems: toJsonValue(computed),
      estimatedTotal: total,
      expiresAt: new Date(Date.now() + DRAFT_TTL_MS),
    });
    return this.toDraftResult(saved, computed);
  }

  async updateWastePercentage(
    draftId: string,
    wastePercentage: number,
    principal: Principal,
  ): Promise<EstimationDraftResult> {
    const draft = await this.loadOwnedEditableDraft(draftId, principal);
    const items = this.readItems(draft);
    const { items: computed, total } = recomputeDraft(items, toMoneyStringOrNull(draft.areaValue, 3), wastePercentage);
    const saved = await this.repo.updateDraft(draft.id, {
      wastePercentage,
      generatedItems: toJsonValue(computed),
      estimatedTotal: total,
      expiresAt: new Date(Date.now() + DRAFT_TTL_MS),
    });
    return this.toDraftResult(saved, computed);
  }

  // ===================== PREVIEW =====================

  async getPreview(draftId: string, principal: Principal): Promise<EstimationPreview> {
    const draft = await this.loadOwnedActiveDraft(draftId, principal);
    if (draft.status !== 'MATERIALS_PENDING' && draft.status !== 'READY_FOR_CONFIRMATION') {
      throw new ConflictError('Draft has no preview yet', 'DRAFT_NOT_PREVIEWABLE');
    }
    const items = this.readItems(draft);
    const base = this.toDraftResult(draft, items);
    const dtoItems = base.items;
    return {
      ...base,
      warning: REVIEW_WARNING,
      existingMaterials: dtoItems.filter((it) => it.resolutionStatus === 'MATCHED'),
      missingMaterials: dtoItems.filter((it) => it.resolutionStatus === 'PENDING_APPROVAL'),
      willCreateMaterials: dtoItems.filter((it) => it.resolutionStatus === 'APPROVED_CREATE'),
    };
  }

  // ===================== CONFIRM =====================

  async confirmDraft(
    draftId: string,
    templateName: string,
    principal: Principal,
  ): Promise<EstimationConfirmResult> {
    const ctx = await this.buildContext(principal);
    const draft = await this.loadOwnedActiveDraft(draftId, principal);
    if (draft.status !== 'READY_FOR_CONFIRMATION') {
      throw new ConflictError('Draft is not ready for confirmation', 'DRAFT_NOT_READY');
    }

    // Fail closed: re-check both gates at execution time (permissions may have
    // been revoked between drafting and confirming).
    if (!ctx.permissions.has('estimation_templates.create')) {
      throw new ForbiddenError('Not allowed to create estimation templates', 'INSUFFICIENT_PERMISSION');
    }
    const items = this.readItems(draft);
    const toCreate = items.filter((it) => it.resolutionStatus === 'APPROVED_CREATE');
    if (toCreate.length > 0 && !ctx.permissions.has('materials.create_from_assistant')) {
      throw new ForbiddenError('Not allowed to create materials via the assistant', 'INSUFFICIENT_PERMISSION');
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const createdMaterials: Array<{ materialId: string; name: string }> = [];

        // 1) Create every approved material via the existing tx-aware path (it
        //    writes its own AuditLog CREATE row inside this same transaction).
        for (const item of toCreate) {
          const name = item.materialNameGuess ?? item.description;
          const created = await this.materials.createWithinTx(
            tx,
            {
              name,
              unit: item.unit ?? DEFAULT_MATERIAL_UNIT,
              defaultPrice: item.unitPrice === null ? null : Number(item.unitPrice),
              notes: null,
              isActive: true,
            },
            ctx.actor,
          );
          item.materialId = created.id;
          createdMaterials.push({ materialId: created.id, name });
        }

        // 2) The confirmed template + its items.
        const template = await this.repo.createTemplate(
          {
            name: templateName,
            projectType: draft.projectType,
            constructionType: draft.constructionType,
            scopeOfWork: draft.scopeOfWork,
            areaValue: draft.areaValue,
            areaUnit: draft.areaUnit,
            wastePercentage: draft.wastePercentage,
            estimatedTotal: draft.estimatedTotal,
            isPreliminary: true,
          },
          tx,
        );
        for (const item of items) {
          await this.repo.createTemplateItem(
            {
              templateId: template.id,
              category: item.category,
              materialId: item.materialId,
              description: item.description,
              quantity: item.quantity,
              unit: item.unit,
              unitPrice: item.unitPrice,
              totalAmount: item.totalAmount,
              sortOrder: item.sortOrder,
              notes: item.notes,
            },
            tx,
          );
        }

        // 3) Generic entity-history trail (same as every other module).
        await this.audit.log(
          ctx.actor,
          { action: 'CREATE', entity: 'EstimationTemplate', entityId: template.id, newValues: toJsonValue(template) },
          tx,
        );

        // 4) Flip the draft to CONFIRMED and link the result.
        await this.repo.updateDraft(
          draft.id,
          { status: 'CONFIRMED', confirmedAt: new Date(), resultTemplateId: template.id },
          tx,
        );

        // 5) Rich narrative audit — INSIDE the tx (must roll back with the rest).
        const existingUsed = items
          .filter((it) => it.resolutionStatus === 'MATCHED' && it.materialId)
          .map((it) => ({ materialId: it.materialId, name: it.materialNameGuess ?? it.description }));
        await this.repo.logEvent(
          {
            draftId: draft.id,
            userId: principal.userId,
            eventType: 'confirmed',
            originalCommand: draft.originalCommand,
            parsedIntent: this.readIntent(draft),
            generatedEstimation: items,
            existingMaterialsUsed: existingUsed,
            newlyCreatedMaterials: createdMaterials,
            executedActions: [
              ...createdMaterials.map((m) => ({ entity: 'Material', entityId: m.materialId, operation: 'create' })),
              { entity: 'EstimationTemplate', entityId: template.id, operation: 'create' },
            ],
            finalSavedValues: { template: toJsonValue(template), items },
            ipAddress: principal.actor.ipAddress ?? null,
            userAgent: principal.actor.userAgent ?? null,
          },
          tx,
        );

        return { template, createdMaterialIds: createdMaterials.map((m) => m.materialId) };
      });

      return {
        kind: 'confirmed',
        draftId: draft.id,
        templateId: result.template.id,
        message: 'تم حفظ قالب التقدير بنجاح.',
        createdMaterialIds: result.createdMaterialIds,
        estimatedTotal: toMoneyString(result.template.estimatedTotal, 2),
      };
    } catch (err) {
      // The tx rolled back everything. Record the failure OUTSIDE the dead tx so
      // it is traceable, then rethrow — never silently swallow (requirement #8).
      const reason = err instanceof Error ? err.message : 'unknown_error';
      try {
        await this.repo.updateDraft(draft.id, { status: 'FAILED' });
        await this.repo.logEvent({
          draftId: draft.id,
          userId: principal.userId,
          eventType: 'failed',
          originalCommand: draft.originalCommand,
          failedReason: reason,
          ipAddress: principal.actor.ipAddress ?? null,
          userAgent: principal.actor.userAgent ?? null,
        });
      } catch (logErr) {
        logger.error({ err: logErr, draftId: draft.id }, 'estimation confirm: failed to record failure');
      }
      throw err;
    }
  }

  // ===================== CANCEL =====================

  async cancelDraft(draftId: string, principal: Principal): Promise<EstimationCancelResult> {
    const draft = await this.loadOwnedActiveDraft(draftId, principal);
    await this.repo.updateDraft(draft.id, { status: 'CANCELLED', cancelledAt: new Date() });
    await this.safeLog({
      draftId: draft.id,
      userId: principal.userId,
      eventType: 'cancelled',
      originalCommand: draft.originalCommand,
      ipAddress: principal.actor.ipAddress ?? null,
      userAgent: principal.actor.userAgent ?? null,
    });
    return { kind: 'cancelled', draftId: draft.id, message: 'تم إلغاء المسودة.' };
  }

  // ===================== DRAFT INSPECTION =====================

  async getDraft(draftId: string, principal: Principal): Promise<EstimationDraftResult | EstimationClarificationResult> {
    const draft = await this.loadOwnedActiveDraft(draftId, principal);
    if (draft.status === 'CLARIFICATION_NEEDED') {
      const qa = (draft.clarificationLog as Array<{ question: string; answer: string }> | null) ?? [];
      const last = qa[qa.length - 1];
      return this.toClarification(draft, last?.question ?? '', []);
    }
    return this.toDraftResult(draft, this.readItems(draft));
  }

  // ===================== CONFIRMED-TEMPLATE CRUD =====================

  async listTemplates(query: ListEstimationTemplatesQuery): Promise<Paginated<EstimationTemplateSummary>> {
    const { skip, take } = toSkipTake(query);
    const [rows, total] = await Promise.all([
      this.repo.listTemplates({ search: query.search, skip, take, sortBy: query.sortBy, sortDir: query.sortDir }),
      this.repo.countTemplates(query.search),
    ]);
    const items = rows.map((t) => ({
      id: t.id,
      name: t.name,
      projectType: t.projectType,
      areaValue: toMoneyStringOrNull(t.areaValue, 3),
      areaUnit: t.areaUnit,
      estimatedTotal: toMoneyString(t.estimatedTotal, 2),
      createdAt: t.createdAt.toISOString(),
    }));
    return buildPaginated(items, total, query);
  }

  async getTemplate(id: string): Promise<EstimationTemplateView> {
    const template = await this.repo.findTemplateByIdWithItems(id);
    if (!template) throw new NotFoundError('Estimation template', 'ESTIMATION_TEMPLATE_NOT_FOUND');
    return this.toTemplateView(template);
  }

  async updateTemplate(
    id: string,
    body: UpdateEstimationTemplateBody,
    principal: Principal,
  ): Promise<EstimationTemplateView> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.estimationTemplate.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundError('Estimation template', 'ESTIMATION_TEMPLATE_NOT_FOUND');
      const updated = await this.repo.updateTemplate(
        id,
        { name: body.name, notes: body.notes },
        tx,
      );
      await this.audit.log(
        principal.actor,
        {
          action: 'UPDATE',
          entity: 'EstimationTemplate',
          entityId: id,
          oldValues: toJsonValue(existing),
          newValues: toJsonValue(updated),
        },
        tx,
      );
      const withItems = await this.repo.findTemplateByIdWithItems(id, tx);
      return this.toTemplateView(withItems!);
    });
  }

  async deleteTemplate(id: string, principal: Principal): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.estimationTemplate.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundError('Estimation template', 'ESTIMATION_TEMPLATE_NOT_FOUND');
      await this.repo.softDeleteTemplate(id, tx);
      await this.audit.log(
        principal.actor,
        { action: 'DELETE', entity: 'EstimationTemplate', entityId: id, oldValues: toJsonValue(existing) },
        tx,
      );
    });
  }

  // ===================== INTERNAL HELPERS =====================

  private async buildContext(principal: Principal): Promise<EstimationContext> {
    const keys = await this.access.permissionsForRole(principal.role);
    return { ...principal, permissions: new Set(keys) };
  }

  /** Load a draft, assert ownership, and lazily expire it if stale. */
  private async loadOwnedActiveDraft(draftId: string, principal: Principal): Promise<EstimationTemplateDraft> {
    const draft = await this.repo.findDraftById(draftId);
    if (!draft || draft.userId !== principal.userId) {
      throw new NotFoundError('Draft', 'DRAFT_NOT_FOUND');
    }
    const terminal =
      draft.status === 'CONFIRMED' ||
      draft.status === 'CANCELLED' ||
      draft.status === 'EXPIRED' ||
      draft.status === 'FAILED';
    if (!terminal && draft.expiresAt.getTime() < Date.now()) {
      await this.repo.updateDraft(draft.id, { status: 'EXPIRED' });
      throw new ConflictError('Draft has expired', 'DRAFT_EXPIRED');
    }
    if (draft.status === 'EXPIRED') throw new ConflictError('Draft has expired', 'DRAFT_EXPIRED');
    return draft;
  }

  private async loadOwnedEditableDraft(draftId: string, principal: Principal): Promise<EstimationTemplateDraft> {
    const draft = await this.loadOwnedActiveDraft(draftId, principal);
    if (draft.status !== 'MATERIALS_PENDING' && draft.status !== 'READY_FOR_CONFIRMATION') {
      throw new ConflictError('Draft is not editable', 'DRAFT_NOT_EDITABLE');
    }
    return draft;
  }

  private async resolveClient(): Promise<{ client: LlmClient | null; provider: LlmProviderName | null }> {
    if (this.injectedClient) return { client: this.injectedClient, provider: this.injectedClient.name };
    const cfg = await this.llmSettings.resolve();
    return { client: createLlmClient(cfg), provider: cfg.provider };
  }

  /** Call the LLM and validate its output; return a discriminated result. */
  private async interpret(
    client: LlmClient,
    user: string,
  ): Promise<{ ok: true; value: LlmEstimationOutput } | { ok: false; reason: string; message: string }> {
    let raw: string;
    try {
      raw = await client.complete({ system: buildEstimationSystemPrompt(), user, schema: LLM_ESTIMATION_JSON_SCHEMA });
    } catch (err) {
      const code = err instanceof LLMError ? err.code : 'llm_error';
      return { ok: false, reason: code, message: llmErrorMessageAr(code) };
    }
    const parsed = parseOutput(raw);
    if (!parsed) {
      return { ok: false, reason: 'invalid_ai_output', message: 'ما فهمت الطلب بوضوح، جرّب صياغة أوضح.' };
    }
    return { ok: true, value: parsed };
  }

  private llmDraftToItems(output: Extract<LlmEstimationOutput, { kind: 'draft' }>): EstimationDraftItemPayload[] {
    return output.items.map((it, i) => ({
      tempId: `it-${i}`,
      category: it.category,
      description: it.description,
      materialNameGuess: it.materialNameGuess,
      ratioPerAreaUnit: it.ratioPerAreaUnit,
      quantity: null,
      unit: it.unit,
      unitPrice: it.unitPrice === null ? null : toMoneyString(it.unitPrice, 2),
      totalAmount: '0.00',
      materialId: null,
      resolutionStatus: it.materialNameGuess ? 'PENDING_APPROVAL' : 'SKIPPED',
      sortOrder: i,
      notes: it.notes,
      userEdited: false,
    }));
  }

  /** Read-only catalog lookup — MATCH existing materials, never create. */
  private async resolveMaterialsAgainstCatalog(
    items: EstimationDraftItemPayload[],
  ): Promise<EstimationDraftItemPayload[]> {
    for (const item of items) {
      if (!item.materialNameGuess) continue; // non-material line — nothing to resolve
      const candidates = await this.repo.findMaterialCandidates(item.materialNameGuess);
      if (candidates.length === 0) {
        item.resolutionStatus = 'PENDING_APPROVAL';
        continue;
      }
      // Prefer an exact case-insensitive name match; else the shortest name
      // (closest to the guess). Multi-candidate disambiguation is future work.
      const guess = item.materialNameGuess.toLowerCase();
      const best =
        candidates.find((c) => c.name.toLowerCase() === guess) ??
        [...candidates].sort((a, b) => a.name.length - b.name.length)[0]!;
      item.resolutionStatus = 'MATCHED';
      item.materialId = best.id;
      item.unit = best.unit;
      if (best.defaultPrice !== null) item.unitPrice = toMoneyString(best.defaultPrice, 2);
    }
    return items;
  }

  private computeStatus(items: EstimationDraftItemPayload[]): 'MATERIALS_PENDING' | 'READY_FOR_CONFIRMATION' {
    return items.some((it) => it.resolutionStatus === 'PENDING_APPROVAL')
      ? 'MATERIALS_PENDING'
      : 'READY_FOR_CONFIRMATION';
  }

  private readItems(draft: EstimationTemplateDraft): EstimationDraftItemPayload[] {
    return (draft.generatedItems as unknown as EstimationDraftItemPayload[]) ?? [];
  }

  private readIntent(draft: EstimationTemplateDraft): ParsedIntent {
    return {
      projectType: draft.projectType,
      constructionType: draft.constructionType,
      scopeOfWork: draft.scopeOfWork,
      templateName: draft.templateName,
      areaValue: draft.areaValue === null ? null : Number(draft.areaValue),
      areaUnit: draft.areaUnit,
      wastePercentage: Number(draft.wastePercentage),
      confidence: draft.confidence,
    };
  }

  private fallbackName(output: Extract<LlmEstimationOutput, { kind: 'draft' }>): string {
    const parts = [output.intent.projectType, output.intent.areaValue ? `${output.intent.areaValue}${output.intent.areaUnit ?? ''}` : null].filter(
      Boolean,
    );
    return parts.length ? `تقدير — ${parts.join(' ')}` : 'قالب تقدير';
  }

  private async safeLog(input: Parameters<EstimationTemplatesRepository['logEvent']>[0]): Promise<void> {
    try {
      await this.repo.logEvent(input);
    } catch (err) {
      // Narrative audit for non-final events is best-effort — never fail the turn.
      logger.error({ err, draftId: input.draftId }, 'estimation audit log failed');
    }
  }

  // ---------- DTO mappers ----------

  private toClarification(
    draft: EstimationTemplateDraft,
    question: string,
    missingFields: string[],
  ): EstimationClarificationResult {
    return {
      kind: 'clarification',
      draftId: draft.id,
      status: 'CLARIFICATION_NEEDED',
      question,
      missingFields,
      confidence: draft.confidence,
    };
  }

  private toDraftResult(draft: EstimationTemplateDraft, items: EstimationDraftItemPayload[]): EstimationDraftResult {
    return {
      kind: 'draft_ready',
      draftId: draft.id,
      status: (draft.status === 'MATERIALS_PENDING' ? 'MATERIALS_PENDING' : 'READY_FOR_CONFIRMATION'),
      templateName: draft.templateName ?? 'قالب تقدير',
      projectType: draft.projectType,
      constructionType: draft.constructionType,
      scopeOfWork: draft.scopeOfWork,
      areaValue: toMoneyStringOrNull(draft.areaValue, 3),
      areaUnit: draft.areaUnit,
      wastePercentage: toMoneyString(draft.wastePercentage, 2),
      estimatedTotal: toMoneyString(draft.estimatedTotal, 2),
      confidence: draft.confidence,
      items: items.map(toDraftItemDto),
    };
  }

  private toTemplateView(
    template: EstimationTemplate & { items: Array<EstimationTemplateItemRow> },
  ): EstimationTemplateView {
    return {
      id: template.id,
      name: template.name,
      projectType: template.projectType,
      constructionType: template.constructionType,
      scopeOfWork: template.scopeOfWork,
      areaValue: toMoneyStringOrNull(template.areaValue, 3),
      areaUnit: template.areaUnit,
      wastePercentage: toMoneyString(template.wastePercentage, 2),
      estimatedTotal: toMoneyString(template.estimatedTotal, 2),
      isPreliminary: template.isPreliminary,
      notes: template.notes,
      items: template.items.map(
        (it): EstimationTemplateItemView => ({
          id: it.id,
          category: it.category,
          materialId: it.materialId,
          description: it.description,
          quantity: toMoneyStringOrNull(it.quantity, 3),
          unit: it.unit,
          unitPrice: toMoneyStringOrNull(it.unitPrice, 2),
          totalAmount: toMoneyString(it.totalAmount, 2),
          sortOrder: it.sortOrder,
          notes: it.notes,
        }),
      ),
      createdAt: template.createdAt.toISOString(),
      updatedAt: template.updatedAt.toISOString(),
    };
  }

  private async rejected(draftId: string | null, reason: string, message: string): Promise<EstimationGenerateResult> {
    return { kind: 'rejected', draftId, reason, message };
  }
}

// ---------- module-level helpers ----------

export interface EstimationTemplateSummary {
  id: string;
  name: string;
  projectType: string | null;
  areaValue: string | null;
  areaUnit: string | null;
  estimatedTotal: string;
  createdAt: string;
}

type EstimationTemplateItemRow = {
  id: string;
  category: CostCategory;
  materialId: string | null;
  description: string;
  quantity: Prisma.Decimal | null;
  unit: string | null;
  unitPrice: Prisma.Decimal | null;
  totalAmount: Prisma.Decimal;
  sortOrder: number;
  notes: string | null;
};

function toDraftItemDto(it: EstimationDraftItemPayload): EstimationDraftItem {
  return {
    tempId: it.tempId,
    category: it.category,
    description: it.description,
    materialNameGuess: it.materialNameGuess,
    materialId: it.materialId,
    resolutionStatus: it.resolutionStatus,
    quantity: it.quantity,
    unit: it.unit,
    unitPrice: it.unitPrice,
    totalAmount: it.totalAmount,
    sortOrder: it.sortOrder,
  };
}

function parseOutput(raw: string): LlmEstimationOutput | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  const result = llmEstimationOutputSchema.safeParse(obj);
  return result.success ? (result.data as LlmEstimationOutput) : null;
}

