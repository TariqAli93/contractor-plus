import { Prisma, type ChangeOrder, type ChangeOrderStatus, type PrismaClient } from '@prisma/client';

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface ChangeOrderListArgs {
  contractId?: string;
  status?: ChangeOrderStatus;
  skip: number;
  take: number;
  sortBy: 'number' | 'createdAt' | 'amount';
  sortDir: 'asc' | 'desc';
}

export class ChangeOrdersRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string, client: DbClient = this.prisma): Promise<ChangeOrder | null> {
    return client.changeOrder.findFirst({ where: { id, deletedAt: null } });
  }

  findMany(args: ChangeOrderListArgs): Promise<ChangeOrder[]> {
    return this.prisma.changeOrder.findMany({
      where: this.buildWhere(args),
      orderBy: { [args.sortBy]: args.sortDir },
      skip: args.skip,
      take: args.take,
    });
  }

  count(args: { contractId?: string; status?: ChangeOrderStatus }): Promise<number> {
    return this.prisma.changeOrder.count({ where: this.buildWhere(args) });
  }

  create(
    data: Prisma.ChangeOrderUncheckedCreateInput,
    client: DbClient = this.prisma,
  ): Promise<ChangeOrder> {
    return client.changeOrder.create({ data });
  }

  update(
    id: string,
    data: Prisma.ChangeOrderUpdateInput,
    client: DbClient = this.prisma,
  ): Promise<ChangeOrder> {
    return client.changeOrder.update({ where: { id }, data });
  }

  softDelete(id: string, client: DbClient = this.prisma): Promise<ChangeOrder> {
    return client.changeOrder.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // Next sequential number for a contract. Counts soft-deleted rows too, since
  // the [contractId, number] uniqueness ignores deletedAt.
  async nextNumber(contractId: string, client: DbClient = this.prisma): Promise<number> {
    const last = await client.changeOrder.findFirst({
      where: { contractId },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    return (last?.number ?? 0) + 1;
  }

  // Sum of APPROVED change-order deltas for a contract.
  async sumApproved(contractId: string, client: DbClient = this.prisma): Promise<Prisma.Decimal> {
    const agg = await client.changeOrder.aggregate({
      where: { contractId, status: 'APPROVED', deletedAt: null },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? new Prisma.Decimal(0);
  }

  countByStatus(
    contractId: string,
    status: ChangeOrderStatus,
    client: DbClient = this.prisma,
  ): Promise<number> {
    return client.changeOrder.count({ where: { contractId, status, deletedAt: null } });
  }

  private buildWhere(args: {
    contractId?: string;
    status?: ChangeOrderStatus;
  }): Prisma.ChangeOrderWhereInput {
    return {
      deletedAt: null,
      ...(args.contractId && { contractId: args.contractId }),
      ...(args.status && { status: args.status }),
    };
  }
}
