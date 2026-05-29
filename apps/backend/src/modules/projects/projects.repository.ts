import {
  ProjectStatus,
  type Contract,
  type Customer,
  type Prisma,
  type PrismaClient,
  type Project,
} from '@prisma/client';
import type { ProjectFilter, ProjectListArgs } from './projects.types.js';

type DbClient = PrismaClient | Prisma.TransactionClient;

const CONTRACT_SUMMARY_SELECT = {
  id: true,
  contractNumber: true,
  totalPrice: true,
  status: true,
  signedAt: true,
  customer: { select: { id: true, name: true } },
} as const;

export type ProjectWithContract = Project & {
  contract:
    | (Pick<Contract, 'id' | 'contractNumber' | 'totalPrice' | 'status' | 'signedAt'> & {
        customer: Pick<Customer, 'id' | 'name'>;
      })
    | null;
};

export class ProjectsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string, client: DbClient = this.prisma): Promise<Project | null> {
    return client.project.findFirst({ where: { id, deletedAt: null } });
  }

  findByIdWithContract(id: string): Promise<ProjectWithContract | null> {
    return this.prisma.project.findFirst({
      where: { id, deletedAt: null },
      include: { contract: { select: CONTRACT_SUMMARY_SELECT } },
    });
  }

  findMany(args: ProjectListArgs): Promise<ProjectWithContract[]> {
    return this.prisma.project.findMany({
      where: this.buildWhere(args),
      orderBy: { [args.sortBy]: args.sortDir },
      include: { contract: { select: CONTRACT_SUMMARY_SELECT } },
      skip: args.skip,
      take: args.take,
    });
  }

  count(filter: ProjectFilter): Promise<number> {
    return this.prisma.project.count({ where: this.buildWhere(filter) });
  }

  existsByContractId(
    contractId: string,
    excludeId?: string,
    client: DbClient = this.prisma,
  ): Promise<boolean> {
    return client.project
      .findFirst({
        where: { contractId, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
        select: { id: true },
      })
      .then((row) => row !== null);
  }

  hasCostsOrPayments(id: string, client: DbClient = this.prisma): Promise<boolean> {
    return Promise.all([
      client.projectCost.count({ where: { projectId: id } }),
      client.payment.count({ where: { projectId: id } }),
    ]).then(([costs, payments]) => costs > 0 || payments > 0);
  }

  create(
    data: Prisma.ProjectUncheckedCreateInput,
    client: DbClient = this.prisma,
  ): Promise<Project> {
    return client.project.create({ data });
  }

  update(
    id: string,
    data: Prisma.ProjectUpdateInput,
    client: DbClient = this.prisma,
  ): Promise<Project> {
    return client.project.update({ where: { id }, data });
  }

  softDelete(id: string, client: DbClient = this.prisma): Promise<Project> {
    return client.project.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  private buildWhere(filter: ProjectFilter): Prisma.ProjectWhereInput {
    const where: Prisma.ProjectWhereInput = {};
    if (!filter.includeDeleted) where.deletedAt = null;
    if (filter.contractId) where.contractId = filter.contractId;

    if (filter.status) {
      where.status = filter.status;
    }
    if (filter.delayed) {
      where.deliveryDate = { lt: new Date() };
      if (!filter.status) {
        where.status = { notIn: [ProjectStatus.COMPLETED, ProjectStatus.CANCELLED] };
      }
    }

    if (filter.search) {
      where.OR = [
        { name: { contains: filter.search, mode: 'insensitive' } },
        { contract: { contractNumber: { contains: filter.search, mode: 'insensitive' } } },
      ];
    }
    return where;
  }
}
