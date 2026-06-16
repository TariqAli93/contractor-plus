import type { Material, Prisma, PrismaClient } from '@prisma/client';
import type { MaterialFilter, MaterialListArgs } from './materials.types.js';

type DbClient = PrismaClient | Prisma.TransactionClient;

export class MaterialsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string): Promise<Material | null> {
    return this.prisma.material.findFirst({
      where: { id, deletedAt: null },
    });
  }

  findMany(args: MaterialListArgs): Promise<Material[]> {
    return this.prisma.material.findMany({
      where: this.buildWhere(args),
      orderBy: { [args.sortBy]: args.sortDir },
      skip: args.skip,
      take: args.take,
    });
  }

  count(filter: MaterialFilter): Promise<number> {
    return this.prisma.material.count({ where: this.buildWhere(filter) });
  }

  create(data: Prisma.MaterialCreateInput, client: DbClient = this.prisma): Promise<Material> {
    return client.material.create({ data });
  }

  update(
    id: string,
    data: Prisma.MaterialUpdateInput,
    client: DbClient = this.prisma,
  ): Promise<Material> {
    return client.material.update({ where: { id }, data });
  }

  softDelete(id: string, client: DbClient = this.prisma): Promise<Material> {
    return client.material.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  private buildWhere(filter: MaterialFilter): Prisma.MaterialWhereInput {
    const where: Prisma.MaterialWhereInput = { deletedAt: null };
    if (filter.isActive !== undefined) {
      where.isActive = filter.isActive;
    }
    if (filter.search) {
      where.OR = [
        { name: { contains: filter.search, mode: 'insensitive' } },
        { unit: { contains: filter.search, mode: 'insensitive' } },
      ];
    }
    return where;
  }
}
