import {
  ContractStatus,
  PaymentStatus,
  ProjectStatus,
  type Payment,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import type { RecentProject } from './reports.types.js';

const TERMINAL_PROJECT_STATUSES: ProjectStatus[] = [
  ProjectStatus.COMPLETED,
  ProjectStatus.CANCELLED,
];

const CONTRACT_SUMMARY_SELECT = {
  id: true,
  contractNumber: true,
  customer: { select: { id: true, name: true } },
} as const;

export interface ProjectProfitabilityFilter {
  status?: ProjectStatus;
  customerId?: string;
}

export interface OverdueFilter {
  customerId?: string;
}

export interface DelayedFilter {
  customerId?: string;
}

export type ProjectWithContractSummary = Awaited<ReturnType<PrismaClient['project']['findFirst']>> &
  RecentProject;

type PaymentWithProject = Payment & {
  project: {
    id: string;
    name: string;
    contract: {
      id: string;
      contractNumber: string;
      customer: { id: string; name: string };
      totalPrice: Prisma.Decimal;
    } | null;
  };
};

export class ReportsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // ---------- Dashboard counters ----------

  countActiveProjects(): Promise<number> {
    return this.prisma.project.count({
      where: { deletedAt: null, status: { notIn: TERMINAL_PROJECT_STATUSES } },
    });
  }

  countDelayedProjects(now: Date): Promise<number> {
    return this.prisma.project.count({
      where: {
        deletedAt: null,
        deliveryDate: { lt: now },
        status: { notIn: TERMINAL_PROJECT_STATUSES },
      },
    });
  }

  countOverduePayments(now: Date): Promise<number> {
    return this.prisma.payment.count({
      where: {
        deletedAt: null,
        OR: [
          { status: PaymentStatus.PENDING, dueDate: { lt: now } },
          { status: PaymentStatus.LATE },
        ],
      },
    });
  }

  // ---------- Money aggregations ----------

  sumPaidPaymentsInRange(from?: Date, to?: Date): Promise<number> {
    return this.prisma.payment
      .aggregate({
        where: {
          deletedAt: null,
          status: PaymentStatus.PAID,
          ...(from || to
            ? { paymentDate: { ...(from && { gte: from }), ...(to && { lte: to }) } }
            : {}),
        },
        _sum: { amount: true },
      })
      .then((r) => Number(r._sum.amount ?? 0));
  }

  sumCostsInRange(from?: Date, to?: Date): Promise<number> {
    return this.prisma.projectCost
      .aggregate({
        where: {
          deletedAt: null,
          ...(from || to ? { date: { ...(from && { gte: from }), ...(to && { lte: to }) } } : {}),
        },
        _sum: { totalAmount: true },
      })
      .then((r) => Number(r._sum.totalAmount ?? 0));
  }

  sumApprovedContractValueInRange(from?: Date, to?: Date): Promise<number> {
    return this.prisma.contract
      .aggregate({
        where: {
          deletedAt: null,
          status: ContractStatus.APPROVED,
          signedAt: { not: null },
          ...(from || to
            ? { signedAt: { not: null, ...(from && { gte: from }), ...(to && { lte: to }) } }
            : {}),
        },
        _sum: { totalPrice: true },
      })
      .then((r) => Number(r._sum.totalPrice ?? 0));
  }

  sumPaidPaymentsTotal(): Promise<number> {
    return this.sumPaidPaymentsInRange();
  }

  sumOutstandingPaymentsTotal(): Promise<number> {
    return this.prisma.payment
      .aggregate({
        where: {
          deletedAt: null,
          status: { in: [PaymentStatus.PENDING, PaymentStatus.LATE] },
        },
        _sum: { amount: true },
      })
      .then((r) => Number(r._sum.amount ?? 0));
  }

  // ---------- Recent lists ----------

  recentProjects(take: number): Promise<RecentProject[]> {
    return this.prisma.project.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        contract: {
          select: {
            id: true,
            contractNumber: true,
            customer: { select: { id: true, name: true } },
            totalPrice: true,
          },
        },
      },
    });
  }

  recentPaidPayments(take: number): Promise<Payment[]> {
    return this.prisma.payment.findMany({
      where: { deletedAt: null, status: PaymentStatus.PAID },
      orderBy: { paymentDate: 'desc' },
      take,
    });
  }

  // ---------- Project profitability ----------

  findProjectsForProfitability(
    filter: ProjectProfitabilityFilter,
    skip: number,
    take: number,
    sortBy: 'createdAt' | 'name' | 'deliveryDate' | 'startDate',
    sortDir: 'asc' | 'desc',
  ): Promise<RecentProject[]> {
    return this.prisma.project.findMany({
      where: this.buildProjectProfitabilityWhere(filter),
      orderBy: { [sortBy]: sortDir },
      include: {
        contract: {
          select: {
            id: true,
            contractNumber: true,
            totalPrice: true,
            customer: { select: { id: true, name: true } },
          },
        },
      } as Prisma.ProjectInclude,
      skip,
      take,
    }) as unknown as Promise<RecentProject[]>;
  }

  countProjectsForProfitability(filter: ProjectProfitabilityFilter): Promise<number> {
    return this.prisma.project.count({
      where: this.buildProjectProfitabilityWhere(filter),
    });
  }

  findProjectForProfitability(projectId: string) {
    return this.prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
      include: {
        contract: {
          select: {
            id: true,
            contractNumber: true,
            totalPrice: true,
            customer: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  sumCostsByProject(projectIds: string[]): Promise<Map<string, number>> {
    if (projectIds.length === 0) return Promise.resolve(new Map());
    return this.prisma.projectCost
      .groupBy({
        by: ['projectId'],
        where: { projectId: { in: projectIds }, deletedAt: null },
        _sum: { totalAmount: true },
      })
      .then((rows) => new Map(rows.map((r) => [r.projectId, Number(r._sum.totalAmount ?? 0)])));
  }

  sumPaidByProject(projectIds: string[]): Promise<Map<string, number>> {
    if (projectIds.length === 0) return Promise.resolve(new Map());
    return this.prisma.payment
      .groupBy({
        by: ['projectId'],
        where: {
          projectId: { in: projectIds },
          status: PaymentStatus.PAID,
          deletedAt: null,
        },
        _sum: { amount: true },
      })
      .then((rows) => new Map(rows.map((r) => [r.projectId, Number(r._sum.amount ?? 0)])));
  }

  // ---------- Overdue payments ----------

  findOverduePayments(now: Date, filter: OverdueFilter): Promise<PaymentWithProject[]> {
    return this.prisma.payment.findMany({
      where: {
        deletedAt: null,
        OR: [
          { status: PaymentStatus.PENDING, dueDate: { lt: now } },
          { status: PaymentStatus.LATE },
        ],
        ...(filter.customerId ? { project: { contract: { customerId: filter.customerId } } } : {}),
      },
      orderBy: { dueDate: 'asc' },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            contract: { select: CONTRACT_SUMMARY_SELECT },
          },
        },
      },
    }) as unknown as Promise<PaymentWithProject[]>;
  }

  // ---------- Delayed projects ----------

  findDelayedProjects(now: Date, filter: DelayedFilter): Promise<RecentProject[]> {
    return this.prisma.project.findMany({
      where: {
        deletedAt: null,
        deliveryDate: { lt: now },
        status: { notIn: TERMINAL_PROJECT_STATUSES },
        ...(filter.customerId ? { contract: { customerId: filter.customerId } } : {}),
      },
      orderBy: { deliveryDate: 'asc' },
      include: {
        contract: {
          select: {
            id: true,
            contractNumber: true,
            totalPrice: true,
            customer: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  // ---------- Helpers ----------

  private buildProjectProfitabilityWhere(
    filter: ProjectProfitabilityFilter,
  ): Prisma.ProjectWhereInput {
    const where: Prisma.ProjectWhereInput = { deletedAt: null };
    if (filter.status) where.status = filter.status;
    if (filter.customerId) where.contract = { customerId: filter.customerId };
    return where;
  }
}
