import type {
  CostCategory,
  Prisma,
  PrismaClient,
  ProjectCost,
} from '@prisma/client';
import type { CostFilter, CostListArgs, CostWithMaterial } from './costs.types.js';

type DbClient = PrismaClient | Prisma.TransactionClient;

const MATERIAL_SUMMARY_SELECT = { id: true, name: true, unit: true } as const;

export class CostsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string, client: DbClient = this.prisma): Promise<ProjectCost | null> {
    return client.projectCost.findFirst({ where: { id, deletedAt: null } });
  }

  findByIdWithMaterial(id: string): Promise<CostWithMaterial | null> {
    return this.prisma.projectCost.findFirst({
      where: { id, deletedAt: null },
      include: { material: { select: MATERIAL_SUMMARY_SELECT } },
    });
  }

  findMany(args: CostListArgs): Promise<CostWithMaterial[]> {
    return this.prisma.projectCost.findMany({
      where: this.buildWhere(args),
      orderBy: { [args.sortBy]: args.sortDir },
      include: { material: { select: MATERIAL_SUMMARY_SELECT } },
      skip: args.skip,
      take: args.take,
    });
  }

  count(filter: CostFilter): Promise<number> {
    return this.prisma.projectCost.count({ where: this.buildWhere(filter) });
  }

  create(
    data: Prisma.ProjectCostUncheckedCreateInput,
    client: DbClient = this.prisma,
  ): Promise<ProjectCost> {
    return client.projectCost.create({ data });
  }

  update(
    id: string,
    data: Prisma.ProjectCostUpdateInput,
    client: DbClient = this.prisma,
  ): Promise<ProjectCost> {
    return client.projectCost.update({ where: { id }, data });
  }

  softDelete(id: string, client: DbClient = this.prisma): Promise<ProjectCost> {
    return client.projectCost.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  sumTotalForProject(projectId: string): Promise<number> {
    return this.prisma.projectCost
      .aggregate({
        where: { projectId, deletedAt: null },
        _sum: { totalAmount: true },
        _count: { _all: true },
      })
      .then((r) => Number(r._sum.totalAmount ?? 0));
  }

  countForProject(projectId: string): Promise<number> {
    return this.prisma.projectCost.count({ where: { projectId, deletedAt: null } });
  }

  sumByCategoryForProject(
    projectId: string,
  ): Promise<Array<{ category: CostCategory; total: number }>> {
    return this.prisma.projectCost
      .groupBy({
        by: ['category'],
        where: { projectId, deletedAt: null },
        _sum: { totalAmount: true },
      })
      .then((rows) =>
        rows.map((r) => ({ category: r.category, total: Number(r._sum.totalAmount ?? 0) })),
      );
  }

  latestForProject(projectId: string, take = 10): Promise<CostWithMaterial[]> {
    return this.prisma.projectCost.findMany({
      where: { projectId, deletedAt: null },
      orderBy: { date: 'desc' },
      take,
      include: { material: { select: MATERIAL_SUMMARY_SELECT } },
    });
  }

  private buildWhere(filter: CostFilter): Prisma.ProjectCostWhereInput {
    const where: Prisma.ProjectCostWhereInput = { deletedAt: null };
    if (filter.projectId) where.projectId = filter.projectId;
    if (filter.category) where.category = filter.category;
    if (filter.dateFrom || filter.dateTo) {
      where.date = {};
      if (filter.dateFrom) where.date.gte = filter.dateFrom;
      if (filter.dateTo) where.date.lte = filter.dateTo;
    }
    if (filter.search) {
      where.description = { contains: filter.search, mode: 'insensitive' };
    }
    return where;
  }
}
