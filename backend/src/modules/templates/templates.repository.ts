import type {
  BuildingTemplate,
  BuildingTemplateItem,
  BuildingTemplateStep,
  Material,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import type { TemplateFilter, TemplateListArgs } from './templates.types.js';

type DbClient = PrismaClient | Prisma.TransactionClient;

export type TemplateWithRelations = BuildingTemplate & {
  items: Array<BuildingTemplateItem & { material: Material }>;
  steps: BuildingTemplateStep[];
};

export class TemplatesRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // ---------- Template ----------

  findById(id: string, client: DbClient = this.prisma): Promise<BuildingTemplate | null> {
    return client.buildingTemplate.findFirst({ where: { id, deletedAt: null } });
  }

  findByIdWithRelations(id: string): Promise<TemplateWithRelations | null> {
    return this.prisma.buildingTemplate.findFirst({
      where: { id, deletedAt: null },
      include: {
        items: { include: { material: true }, orderBy: { createdAt: 'asc' } },
        steps: { orderBy: { sortOrder: 'asc' } },
      },
    });
  }

  findMany(args: TemplateListArgs): Promise<BuildingTemplate[]> {
    return this.prisma.buildingTemplate.findMany({
      where: this.buildWhere(args),
      orderBy: { [args.sortBy]: args.sortDir },
      skip: args.skip,
      take: args.take,
    });
  }

  count(filter: TemplateFilter): Promise<number> {
    return this.prisma.buildingTemplate.count({ where: this.buildWhere(filter) });
  }

  create(
    data: Prisma.BuildingTemplateCreateInput,
    client: DbClient = this.prisma,
  ): Promise<BuildingTemplate> {
    return client.buildingTemplate.create({ data });
  }

  update(
    id: string,
    data: Prisma.BuildingTemplateUpdateInput,
    client: DbClient = this.prisma,
  ): Promise<BuildingTemplate> {
    return client.buildingTemplate.update({ where: { id }, data });
  }

  softDelete(id: string, client: DbClient = this.prisma): Promise<BuildingTemplate> {
    return client.buildingTemplate.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ---------- Items ----------

  findItem(itemId: string, client: DbClient = this.prisma): Promise<BuildingTemplateItem | null> {
    return client.buildingTemplateItem.findUnique({ where: { id: itemId } });
  }

  createItem(
    data: Prisma.BuildingTemplateItemUncheckedCreateInput,
    client: DbClient = this.prisma,
  ): Promise<BuildingTemplateItem> {
    return client.buildingTemplateItem.create({ data });
  }

  updateItem(
    itemId: string,
    data: Prisma.BuildingTemplateItemUpdateInput,
    client: DbClient = this.prisma,
  ): Promise<BuildingTemplateItem> {
    return client.buildingTemplateItem.update({ where: { id: itemId }, data });
  }

  deleteItem(itemId: string, client: DbClient = this.prisma): Promise<BuildingTemplateItem> {
    return client.buildingTemplateItem.delete({ where: { id: itemId } });
  }

  // ---------- Steps ----------

  findStep(stepId: string, client: DbClient = this.prisma): Promise<BuildingTemplateStep | null> {
    return client.buildingTemplateStep.findUnique({ where: { id: stepId } });
  }

  listStepsByTemplate(
    templateId: string,
    client: DbClient = this.prisma,
  ): Promise<BuildingTemplateStep[]> {
    return client.buildingTemplateStep.findMany({
      where: { templateId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  createStep(
    data: Prisma.BuildingTemplateStepUncheckedCreateInput,
    client: DbClient = this.prisma,
  ): Promise<BuildingTemplateStep> {
    return client.buildingTemplateStep.create({ data });
  }

  updateStep(
    stepId: string,
    data: Prisma.BuildingTemplateStepUpdateInput,
    client: DbClient = this.prisma,
  ): Promise<BuildingTemplateStep> {
    return client.buildingTemplateStep.update({ where: { id: stepId }, data });
  }

  deleteStep(stepId: string, client: DbClient = this.prisma): Promise<BuildingTemplateStep> {
    return client.buildingTemplateStep.delete({ where: { id: stepId } });
  }

  // ---------- Helpers ----------

  private buildWhere(filter: TemplateFilter): Prisma.BuildingTemplateWhereInput {
    const where: Prisma.BuildingTemplateWhereInput = { deletedAt: null };
    if (filter.isActive !== undefined) where.isActive = filter.isActive;
    if (filter.search) {
      where.name = { contains: filter.search, mode: 'insensitive' };
    }
    return where;
  }
}
