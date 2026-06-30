import {
  PaymentStatus,
  type Payment,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import { money, type Money } from '../../lib/money.js';
import type { PaymentFilter, PaymentListArgs } from './payments.types.js';

type DbClient = PrismaClient | Prisma.TransactionClient;

export class PaymentsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string, client: DbClient = this.prisma): Promise<Payment | null> {
    return client.payment.findFirst({ where: { id, deletedAt: null } });
  }

  findMany(args: PaymentListArgs): Promise<Payment[]> {
    return this.prisma.payment.findMany({
      where: this.buildWhere(args),
      orderBy: { [args.sortBy]: args.sortDir },
      skip: args.skip,
      take: args.take,
    });
  }

  count(filter: PaymentFilter): Promise<number> {
    return this.prisma.payment.count({ where: this.buildWhere(filter) });
  }

  create(
    data: Prisma.PaymentUncheckedCreateInput,
    client: DbClient = this.prisma,
  ): Promise<Payment> {
    return client.payment.create({ data });
  }

  update(
    id: string,
    data: Prisma.PaymentUpdateInput,
    client: DbClient = this.prisma,
  ): Promise<Payment> {
    return client.payment.update({ where: { id }, data });
  }

  softDelete(id: string, client: DbClient = this.prisma): Promise<Payment> {
    return client.payment.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ----- Summary aggregations -----

  sumPaidForProject(projectId: string): Promise<Money> {
    return this.prisma.payment
      .aggregate({
        where: { projectId, status: PaymentStatus.PAID, deletedAt: null },
        _sum: { amount: true },
      })
      .then((r) => money(r._sum.amount ?? 0));
  }

  countPendingNotLateForProject(projectId: string, now: Date): Promise<number> {
    return this.prisma.payment.count({
      where: {
        projectId,
        status: PaymentStatus.PENDING,
        dueDate: { gte: now },
        deletedAt: null,
      },
    });
  }

  countLateForProject(projectId: string, now: Date): Promise<number> {
    return this.prisma.payment.count({
      where: {
        projectId,
        deletedAt: null,
        OR: [
          { status: PaymentStatus.PENDING, dueDate: { lt: now } },
          { status: PaymentStatus.LATE },
        ],
      },
    });
  }

  countByStatusForProject(projectId: string, status: PaymentStatus): Promise<number> {
    return this.prisma.payment.count({
      where: { projectId, status, deletedAt: null },
    });
  }

  latestForProject(projectId: string, take = 10): Promise<Payment[]> {
    return this.prisma.payment.findMany({
      where: { projectId, deletedAt: null },
      orderBy: { dueDate: 'desc' },
      take,
    });
  }

  private buildWhere(filter: PaymentFilter): Prisma.PaymentWhereInput {
    const where: Prisma.PaymentWhereInput = { deletedAt: null };
    if (filter.projectId) where.projectId = filter.projectId;
    if (filter.status) where.status = filter.status;
    if (filter.dueDateFrom || filter.dueDateTo) {
      where.dueDate = {};
      if (filter.dueDateFrom) where.dueDate.gte = filter.dueDateFrom;
      if (filter.dueDateTo) where.dueDate.lte = filter.dueDateTo;
    }
    if (filter.late) {
      const now = new Date();
      where.dueDate = { ...(where.dueDate as object), lt: now };
      if (!filter.status) {
        where.status = PaymentStatus.PENDING;
      }
    }
    if (filter.search) {
      where.reference = { contains: filter.search, mode: 'insensitive' };
    }
    return where;
  }
}
