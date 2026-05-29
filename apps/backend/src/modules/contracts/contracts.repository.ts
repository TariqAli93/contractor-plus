import type {
  Contract,
  ContractItem,
  ContractStatus,
  Customer,
  BuildingTemplate,
  Material,
  Prisma,
  PrismaClient,
  Project,
} from '@prisma/client';
import type { ContractFilter, ContractListArgs } from './contracts.types.js';

type DbClient = PrismaClient | Prisma.TransactionClient;

export type ContractWithRelations = Contract & {
  customer: Customer;
  template: BuildingTemplate | null;
  items: Array<ContractItem & { material: Material }>;
  project: Project | null;
};

export class ContractsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string, client: DbClient = this.prisma): Promise<Contract | null> {
    return client.contract.findFirst({ where: { id, deletedAt: null } });
  }

  findByIdWithRelations(id: string): Promise<ContractWithRelations | null> {
    return this.prisma.contract.findFirst({
      where: { id, deletedAt: null },
      include: {
        customer: true,
        template: true,
        items: { include: { material: true }, orderBy: { createdAt: 'asc' } },
        project: true,
      },
    });
  }

  findMany(args: ContractListArgs): Promise<Contract[]> {
    return this.prisma.contract.findMany({
      where: this.buildWhere(args),
      orderBy: { [args.sortBy]: args.sortDir },
      include: { customer: true, project: true },
      skip: args.skip,
      take: args.take,
    });
  }

  count(filter: ContractFilter): Promise<number> {
    return this.prisma.contract.count({ where: this.buildWhere(filter) });
  }

  create(
    data: Prisma.ContractUncheckedCreateInput,
    client: DbClient = this.prisma,
  ): Promise<Contract> {
    return client.contract.create({ data });
  }

  update(
    id: string,
    data: Prisma.ContractUpdateInput,
    client: DbClient = this.prisma,
  ): Promise<Contract> {
    return client.contract.update({ where: { id }, data });
  }

  softDelete(id: string, client: DbClient = this.prisma): Promise<Contract> {
    return client.contract.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  existsByContractNumber(
    contractNumber: string,
    excludeId?: string,
    client: DbClient = this.prisma,
  ): Promise<boolean> {
    return client.contract
      .findFirst({
        where: {
          contractNumber,
          ...(excludeId ? { NOT: { id: excludeId } } : {}),
        },
        select: { id: true },
      })
      .then((row) => row !== null);
  }

  replaceItems(
    contractId: string,
    items: Prisma.ContractItemUncheckedCreateInput[],
    client: DbClient = this.prisma,
  ): Promise<Prisma.BatchPayload> {
    return client.contractItem.deleteMany({ where: { contractId } }).then(() =>
      client.contractItem.createMany({ data: items }),
    );
  }

  hasProject(contractId: string, client: DbClient = this.prisma): Promise<boolean> {
    return client.project
      .findUnique({ where: { contractId }, select: { id: true } })
      .then((row) => row !== null);
  }

  private buildWhere(filter: ContractFilter): Prisma.ContractWhereInput {
    const where: Prisma.ContractWhereInput = {};
    if (!filter.includeDeleted) where.deletedAt = null;
    if (filter.status) where.status = filter.status;
    if (filter.customerId) where.customerId = filter.customerId;
    if (filter.search) {
      where.OR = [
        { contractNumber: { contains: filter.search, mode: 'insensitive' } },
        { customer: { name: { contains: filter.search, mode: 'insensitive' } } },
      ];
    }
    return where;
  }
}
