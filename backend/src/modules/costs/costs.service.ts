import {
  CostCategory,
  type Prisma,
  type PrismaClient,
  type ProjectCost,
} from '@prisma/client';
import { CostsRepository } from './costs.repository.js';
import { AuditService, type AuditActor } from '../audit/audit.service.js';
import { NotFoundError } from '../../shared/errors/not-found.error.js';
import { ValidationError } from '../../shared/errors/validation.error.js';
import { toJsonValue } from '../../shared/utils/json.js';
import { buildPaginated, toSkipTake } from '../../shared/utils/pagination.js';
import type { Paginated } from '../../shared/types/pagination.js';
import type {
  CreateCostInput,
  ListCostsQuery,
  UpdateCostInput,
} from './costs.schemas.js';
import type { CostWithMaterial, ProjectCostSummary } from './costs.types.js';

const COST = 'ProjectCost';
const LATEST_COSTS_LIMIT = 10;

// totalAmount derivation rule:
// If both quantity and unitPrice are present (post-merge for updates), totalAmount
// is always quantity × unitPrice. User-supplied totalAmount is ignored in that case.
// Otherwise totalAmount must be supplied explicitly.

export class CostsService {
  private readonly repo: CostsRepository;
  private readonly audit: AuditService;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new CostsRepository(prisma);
    this.audit = new AuditService(prisma);
  }

  // ---------- CRUD ----------

  async list(query: ListCostsQuery): Promise<Paginated<CostWithMaterial>> {
    const { skip, take } = toSkipTake(query);
    const [items, total] = await Promise.all([
      this.repo.findMany({
        search: query.search,
        projectId: query.projectId,
        category: query.category,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        skip,
        take,
        sortBy: query.sortBy,
        sortDir: query.sortDir,
      }),
      this.repo.count({
        search: query.search,
        projectId: query.projectId,
        category: query.category,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      }),
    ]);
    return buildPaginated(items, total, query);
  }

  async getById(id: string): Promise<CostWithMaterial> {
    const cost = await this.repo.findByIdWithMaterial(id);
    if (!cost) throw new NotFoundError('Cost', 'COST_NOT_FOUND');
    return cost;
  }

  async create(data: CreateCostInput, actor: AuditActor): Promise<ProjectCost> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertProjectExists(tx, data.projectId);

      this.assertCategoryMaterialCoherence(data.category, data.materialId);
      if (data.materialId) await this.assertMaterialExists(tx, data.materialId);

      const totalAmount = this.resolveTotalAmount(
        data.quantity,
        data.unitPrice,
        data.totalAmount,
      );

      const created = await this.repo.create(
        {
          projectId: data.projectId,
          category: data.category,
          materialId: data.materialId,
          description: data.description,
          quantity: data.quantity,
          unit: data.unit,
          unitPrice: data.unitPrice,
          totalAmount,
          date: data.date,
          notes: data.notes,
        },
        tx,
      );

      await this.audit.log(
        actor,
        { action: 'CREATE', entity: COST, entityId: created.id, newValues: toJsonValue(created) },
        tx,
      );
      return created;
    });
  }

  async update(
    id: string,
    data: UpdateCostInput,
    actor: AuditActor,
  ): Promise<ProjectCost> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.repo.findById(id, tx);
      if (!existing) throw new NotFoundError('Cost', 'COST_NOT_FOUND');

      // Merge body over existing, treating `undefined` as "no change" and explicit null as "clear".
      const merged = {
        category: data.category ?? existing.category,
        materialId: 'materialId' in data ? data.materialId : existing.materialId,
        quantity: 'quantity' in data ? data.quantity : existing.quantity !== null
          ? Number(existing.quantity)
          : null,
        unitPrice: 'unitPrice' in data ? data.unitPrice : existing.unitPrice !== null
          ? Number(existing.unitPrice)
          : null,
      };

      this.assertCategoryMaterialCoherence(merged.category, merged.materialId ?? null);
      if (data.materialId !== undefined && data.materialId !== null) {
        await this.assertMaterialExists(tx, data.materialId);
      }

      const totalAmount = this.resolveTotalAmount(
        merged.quantity,
        merged.unitPrice,
        data.totalAmount ?? Number(existing.totalAmount),
      );

      const updated = await this.repo.update(
        id,
        {
          ...(data.category !== undefined && { category: data.category }),
          ...('materialId' in data && { materialId: data.materialId }),
          ...(data.description !== undefined && { description: data.description }),
          ...('quantity' in data && { quantity: data.quantity }),
          ...(data.unit !== undefined && { unit: data.unit }),
          ...('unitPrice' in data && { unitPrice: data.unitPrice }),
          ...(data.date !== undefined && { date: data.date }),
          ...(data.notes !== undefined && { notes: data.notes }),
          totalAmount,
        },
        tx,
      );

      await this.audit.log(
        actor,
        {
          action: 'UPDATE',
          entity: COST,
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
      if (!existing) throw new NotFoundError('Cost', 'COST_NOT_FOUND');

      await this.repo.softDelete(id, tx);
      await this.audit.log(
        actor,
        { action: 'DELETE', entity: COST, entityId: id, oldValues: toJsonValue(existing) },
        tx,
      );
    });
  }

  // ---------- Project-scoped views ----------

  async listForProject(
    projectId: string,
    query: ListCostsQuery,
  ): Promise<Paginated<CostWithMaterial>> {
    await this.assertProjectExists(this.prisma, projectId);
    return this.list({ ...query, projectId });
  }

  async getProjectSummary(projectId: string): Promise<ProjectCostSummary> {
    await this.assertProjectExists(this.prisma, projectId);

    const [totalCosts, costCount, byCategory, latestCosts] = await Promise.all([
      this.repo.sumTotalForProject(projectId),
      this.repo.countForProject(projectId),
      this.repo.sumByCategoryForProject(projectId),
      this.repo.latestForProject(projectId, LATEST_COSTS_LIMIT),
    ]);

    const totalByCategory: Record<CostCategory, number> = {
      [CostCategory.MATERIAL]: 0,
      [CostCategory.LABOR]: 0,
      [CostCategory.MACHINERY]: 0,
      [CostCategory.TRANSPORT]: 0,
      [CostCategory.MISC]: 0,
    };
    for (const row of byCategory) {
      totalByCategory[row.category] = round2(row.total);
    }

    return {
      projectId,
      totalCosts: round2(totalCosts),
      costCount,
      materialCosts: totalByCategory[CostCategory.MATERIAL],
      laborCosts: totalByCategory[CostCategory.LABOR],
      machineryCosts: totalByCategory[CostCategory.MACHINERY],
      transportCosts: totalByCategory[CostCategory.TRANSPORT],
      miscCosts: totalByCategory[CostCategory.MISC],
      totalByCategory,
      latestCosts,
    };
  }

  // ---------- Guards & helpers ----------

  private assertCategoryMaterialCoherence(
    category: CostCategory,
    materialId: string | null,
  ): void {
    if (materialId && category !== CostCategory.MATERIAL) {
      throw new ValidationError('materialId can only be set when category is MATERIAL', {
        materialId: ['only allowed when category is MATERIAL'],
      });
    }
  }

  private resolveTotalAmount(
    quantity: number | null | undefined,
    unitPrice: number | null | undefined,
    fallback: number | undefined,
  ): number {
    if (quantity != null && unitPrice != null) {
      return round2(quantity * unitPrice);
    }
    if (fallback == null) {
      throw new ValidationError(
        'totalAmount is required when quantity and unitPrice are not both provided',
        { totalAmount: ['required'] },
      );
    }
    return round2(fallback);
  }

  private async assertProjectExists(
    tx: Prisma.TransactionClient | PrismaClient,
    id: string,
  ): Promise<void> {
    const p = await tx.project.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!p) throw new NotFoundError('Project', 'PROJECT_NOT_FOUND');
  }

  private async assertMaterialExists(
    tx: Prisma.TransactionClient | PrismaClient,
    id: string,
  ): Promise<void> {
    const m = await tx.material.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!m) throw new NotFoundError('Material', 'MATERIAL_NOT_FOUND');
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
