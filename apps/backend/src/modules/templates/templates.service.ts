import type {
  BuildingTemplate,
  BuildingTemplateItem,
  BuildingTemplateStep,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { TemplatesRepository, type TemplateWithRelations } from './templates.repository.js';
import { AuditService, type AuditActor } from '../audit/audit.service.js';
import { NotFoundError } from '../../shared/errors/not-found.error.js';
import { ConflictError } from '../../shared/errors/conflict.error.js';
import { toJsonValue } from '../../shared/utils/json.js';
import { buildPaginated, toSkipTake } from '../../shared/utils/pagination.js';
import type { Paginated } from '../../shared/types/pagination.js';
import type {
  CreateTemplateInput,
  CreateTemplateItemInput,
  CreateTemplateStepInput,
  ListTemplatesQuery,
  UpdateTemplateInput,
  UpdateTemplateItemInput,
  UpdateTemplateStepInput,
} from './templates.schemas.js';
import type { TemplateEstimate } from './templates.types.js';

const TEMPLATE = 'BuildingTemplate';
const ITEM = 'BuildingTemplateItem';
const STEP = 'BuildingTemplateStep';
const PERCENTAGE_EPSILON = 0.01;

export class TemplatesService {
  private readonly repo: TemplatesRepository;
  private readonly audit: AuditService;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new TemplatesRepository(prisma);
    this.audit = new AuditService(prisma);
  }

  // ---------- Template CRUD ----------

  async list(query: ListTemplatesQuery): Promise<Paginated<BuildingTemplate>> {
    const { skip, take } = toSkipTake(query);
    const [items, total] = await Promise.all([
      this.repo.findMany({
        search: query.search,
        isActive: query.isActive,
        skip,
        take,
        sortBy: query.sortBy,
        sortDir: query.sortDir,
      }),
      this.repo.count({ search: query.search, isActive: query.isActive }),
    ]);
    return buildPaginated(items, total, query);
  }

  async getById(id: string): Promise<TemplateWithRelations> {
    const template = await this.repo.findByIdWithRelations(id);
    if (!template) throw new NotFoundError('Template', 'TEMPLATE_NOT_FOUND');
    return template;
  }

  async create(data: CreateTemplateInput, actor: AuditActor): Promise<BuildingTemplate> {
    return this.prisma.$transaction(async (tx) => {
      const created = await this.repo.create(data, tx);
      await this.audit.log(
        actor,
        { action: 'CREATE', entity: TEMPLATE, entityId: created.id, newValues: toJsonValue(created) },
        tx,
      );
      return created;
    });
  }

  async update(
    id: string,
    data: UpdateTemplateInput,
    actor: AuditActor,
  ): Promise<BuildingTemplate> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.repo.findById(id, tx);
      if (!existing) throw new NotFoundError('Template', 'TEMPLATE_NOT_FOUND');

      const updated = await this.repo.update(id, data, tx);
      await this.audit.log(
        actor,
        {
          action: 'UPDATE',
          entity: TEMPLATE,
          entityId: id,
          oldValues: toJsonValue(existing),
          newValues: toJsonValue(updated),
        },
        tx,
      );
      return updated;
    });
  }

  async softDelete(id: string, actor: AuditActor): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await this.repo.findById(id, tx);
      if (!existing) throw new NotFoundError('Template', 'TEMPLATE_NOT_FOUND');

      await this.repo.softDelete(id, tx);
      await this.audit.log(
        actor,
        {
          action: 'DELETE',
          entity: TEMPLATE,
          entityId: id,
          oldValues: toJsonValue(existing),
        },
        tx,
      );
    });
  }

  // ---------- Items ----------

  async addItem(
    templateId: string,
    data: CreateTemplateItemInput,
    actor: AuditActor,
  ): Promise<BuildingTemplateItem> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertTemplateExists(tx, templateId);
      await this.assertMaterialExists(tx, data.materialId);

      const created = await this.repo.createItem(
        {
          templateId,
          materialId: data.materialId,
          quantityFormula: data.quantityFormula,
          estimatedQuantity: data.estimatedQuantity,
          estimatedPrice: data.estimatedPrice,
          notes: data.notes,
        },
        tx,
      );
      await this.audit.log(
        actor,
        { action: 'CREATE', entity: ITEM, entityId: created.id, newValues: toJsonValue(created) },
        tx,
      );
      return created;
    });
  }

  async updateItem(
    templateId: string,
    itemId: string,
    data: UpdateTemplateItemInput,
    actor: AuditActor,
  ): Promise<BuildingTemplateItem> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertTemplateExists(tx, templateId);
      const existing = await this.repo.findItem(itemId, tx);
      if (!existing || existing.templateId !== templateId) {
        throw new NotFoundError('Template item', 'TEMPLATE_ITEM_NOT_FOUND');
      }
      if (data.materialId && data.materialId !== existing.materialId) {
        await this.assertMaterialExists(tx, data.materialId);
      }

      const updated = await this.repo.updateItem(itemId, data, tx);
      await this.audit.log(
        actor,
        {
          action: 'UPDATE',
          entity: ITEM,
          entityId: itemId,
          oldValues: toJsonValue(existing),
          newValues: toJsonValue(updated),
        },
        tx,
      );
      return updated;
    });
  }

  async removeItem(templateId: string, itemId: string, actor: AuditActor): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.assertTemplateExists(tx, templateId);
      const existing = await this.repo.findItem(itemId, tx);
      if (!existing || existing.templateId !== templateId) {
        throw new NotFoundError('Template item', 'TEMPLATE_ITEM_NOT_FOUND');
      }

      await this.repo.deleteItem(itemId, tx);
      await this.audit.log(
        actor,
        {
          action: 'DELETE',
          entity: ITEM,
          entityId: itemId,
          oldValues: toJsonValue(existing),
        },
        tx,
      );
    });
  }

  // ---------- Steps ----------

  async addStep(
    templateId: string,
    data: CreateTemplateStepInput,
    actor: AuditActor,
  ): Promise<BuildingTemplateStep> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertTemplateExists(tx, templateId);
      await this.assertStepInvariants(tx, templateId, {
        sortOrder: data.sortOrder,
        percentage: data.percentage,
      });

      const created = await this.repo.createStep(
        {
          templateId,
          name: data.name,
          percentage: data.percentage,
          sortOrder: data.sortOrder,
          estimatedDays: data.estimatedDays,
        },
        tx,
      );
      await this.audit.log(
        actor,
        { action: 'CREATE', entity: STEP, entityId: created.id, newValues: toJsonValue(created) },
        tx,
      );
      return created;
    });
  }

  async updateStep(
    templateId: string,
    stepId: string,
    data: UpdateTemplateStepInput,
    actor: AuditActor,
  ): Promise<BuildingTemplateStep> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertTemplateExists(tx, templateId);
      const existing = await this.repo.findStep(stepId, tx);
      if (!existing || existing.templateId !== templateId) {
        throw new NotFoundError('Template step', 'TEMPLATE_STEP_NOT_FOUND');
      }

      const nextSortOrder = data.sortOrder ?? existing.sortOrder;
      const nextPercentage = data.percentage ?? Number(existing.percentage);
      await this.assertStepInvariants(
        tx,
        templateId,
        { sortOrder: nextSortOrder, percentage: nextPercentage },
        stepId,
      );

      const updated = await this.repo.updateStep(stepId, data, tx);
      await this.audit.log(
        actor,
        {
          action: 'UPDATE',
          entity: STEP,
          entityId: stepId,
          oldValues: toJsonValue(existing),
          newValues: toJsonValue(updated),
        },
        tx,
      );
      return updated;
    });
  }

  async removeStep(templateId: string, stepId: string, actor: AuditActor): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.assertTemplateExists(tx, templateId);
      const existing = await this.repo.findStep(stepId, tx);
      if (!existing || existing.templateId !== templateId) {
        throw new NotFoundError('Template step', 'TEMPLATE_STEP_NOT_FOUND');
      }

      await this.repo.deleteStep(stepId, tx);
      await this.audit.log(
        actor,
        {
          action: 'DELETE',
          entity: STEP,
          entityId: stepId,
          oldValues: toJsonValue(existing),
        },
        tx,
      );
    });
  }

  // ---------- Estimate ----------

  async getEstimate(templateId: string): Promise<TemplateEstimate> {
    const template = await this.repo.findByIdWithRelations(templateId);
    if (!template) throw new NotFoundError('Template', 'TEMPLATE_NOT_FOUND');

    const estimatedMaterialCost = template.items.reduce(
      (sum, item) => sum + Number(item.estimatedPrice),
      0,
    );

    const totalStepsEstimatedDays = template.steps.reduce(
      (sum, step) => sum + (step.estimatedDays ?? 0),
      0,
    );

    const totalStepsPercentage = template.steps.reduce(
      (sum, step) => sum + Number(step.percentage),
      0,
    );

    const profitMargin =
      template.suggestedProfitMargin !== null ? Number(template.suggestedProfitMargin) : null;

    const estimatedProfitAmount =
      profitMargin !== null ? round2(estimatedMaterialCost * (profitMargin / 100)) : null;

    const estimatedSellingPrice =
      estimatedProfitAmount !== null
        ? round2(estimatedMaterialCost + estimatedProfitAmount)
        : null;

    const estimatedDurationDays =
      template.estimatedDurationDays ??
      (totalStepsEstimatedDays > 0 ? totalStepsEstimatedDays : null);

    return {
      templateId: template.id,
      templateName: template.name,
      estimatedMaterialCost: round2(estimatedMaterialCost),
      estimatedDurationDays,
      suggestedProfitMargin: profitMargin,
      estimatedProfitAmount,
      estimatedSellingPrice,
      materials: template.items.map((item) => ({
        itemId: item.id,
        materialId: item.materialId,
        materialName: item.material.name,
        unit: item.material.unit,
        quantityFormula: item.quantityFormula,
        estimatedQuantity: Number(item.estimatedQuantity),
        estimatedPrice: Number(item.estimatedPrice),
        notes: item.notes,
      })),
      steps: template.steps.map((step) => ({
        id: step.id,
        name: step.name,
        sortOrder: step.sortOrder,
        percentage: Number(step.percentage),
        estimatedDays: step.estimatedDays,
      })),
      summary: {
        itemCount: template.items.length,
        stepCount: template.steps.length,
        totalStepsPercentage: round2(totalStepsPercentage),
        totalStepsEstimatedDays,
      },
    };
  }

  // ---------- Guards ----------

  private async assertTemplateExists(tx: Prisma.TransactionClient, id: string): Promise<void> {
    const exists = await this.repo.findById(id, tx);
    if (!exists) throw new NotFoundError('Template', 'TEMPLATE_NOT_FOUND');
  }

  private async assertMaterialExists(tx: Prisma.TransactionClient, id: string): Promise<void> {
    const material = await tx.material.findFirst({ where: { id, deletedAt: null } });
    if (!material) throw new NotFoundError('Material', 'MATERIAL_NOT_FOUND');
  }

  private async assertStepInvariants(
    tx: Prisma.TransactionClient,
    templateId: string,
    incoming: { sortOrder: number; percentage: number },
    excludeStepId?: string,
  ): Promise<void> {
    const others = await tx.buildingTemplateStep.findMany({
      where: {
        templateId,
        ...(excludeStepId ? { NOT: { id: excludeStepId } } : {}),
      },
      select: { sortOrder: true, percentage: true },
    });

    if (others.some((s) => s.sortOrder === incoming.sortOrder)) {
      throw new ConflictError(
        `sortOrder ${incoming.sortOrder} already used in this template`,
        'STEP_SORT_ORDER_CONFLICT',
      );
    }

    const totalAfter =
      others.reduce((sum, s) => sum + Number(s.percentage), 0) + incoming.percentage;
    if (totalAfter > 100 + PERCENTAGE_EPSILON) {
      throw new ConflictError(
        `Construction steps would total ${totalAfter.toFixed(2)}% (max 100%)`,
        'STEP_PERCENTAGE_OVER_100',
      );
    }
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
