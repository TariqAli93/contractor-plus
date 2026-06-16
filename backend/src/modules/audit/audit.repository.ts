import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  AuditLogFilter,
  AuditLogListArgs,
  AuditLogWithUser,
  EntityHistoryArgs,
  UserHistoryArgs,
} from './audit.types.js';

const USER_SUMMARY_SELECT = {
  id: true,
  email: true,
  fullName: true,
} as const;

export class AuditRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string): Promise<AuditLogWithUser | null> {
    return this.prisma.auditLog.findUnique({
      where: { id },
      include: { user: { select: USER_SUMMARY_SELECT } },
    });
  }

  findMany(args: AuditLogListArgs): Promise<AuditLogWithUser[]> {
    return this.prisma.auditLog.findMany({
      where: this.buildWhere(args),
      orderBy: { createdAt: args.sortDir },
      include: { user: { select: USER_SUMMARY_SELECT } },
      skip: args.skip,
      take: args.take,
    });
  }

  count(filter: AuditLogFilter): Promise<number> {
    return this.prisma.auditLog.count({ where: this.buildWhere(filter) });
  }

  findEntityHistory(args: EntityHistoryArgs): Promise<AuditLogWithUser[]> {
    return this.prisma.auditLog.findMany({
      where: { entity: args.entity, entityId: args.entityId },
      orderBy: { createdAt: args.sortDir },
      include: { user: { select: USER_SUMMARY_SELECT } },
      skip: args.skip,
      take: args.take,
    });
  }

  countEntityHistory(entity: string, entityId: string): Promise<number> {
    return this.prisma.auditLog.count({ where: { entity, entityId } });
  }

  findUserHistory(args: UserHistoryArgs): Promise<AuditLogWithUser[]> {
    return this.prisma.auditLog.findMany({
      where: this.buildUserHistoryWhere(args),
      orderBy: { createdAt: args.sortDir },
      include: { user: { select: USER_SUMMARY_SELECT } },
      skip: args.skip,
      take: args.take,
    });
  }

  countUserHistory(args: Omit<UserHistoryArgs, 'skip' | 'take' | 'sortDir'>): Promise<number> {
    return this.prisma.auditLog.count({ where: this.buildUserHistoryWhere(args) });
  }

  // ---------- Helpers ----------

  private buildWhere(filter: AuditLogFilter): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = {};
    if (filter.entity) where.entity = filter.entity;
    if (filter.entityId) where.entityId = filter.entityId;
    if (filter.action) where.action = filter.action;
    if (filter.userId) where.userId = filter.userId;
    if (filter.dateFrom || filter.dateTo) {
      where.createdAt = {};
      if (filter.dateFrom) where.createdAt.gte = filter.dateFrom;
      if (filter.dateTo) where.createdAt.lte = filter.dateTo;
    }
    return where;
  }

  private buildUserHistoryWhere(args: {
    userId: string;
    entity?: string;
    action?: import('@prisma/client').AuditAction;
    dateFrom?: Date;
    dateTo?: Date;
  }): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = { userId: args.userId };
    if (args.entity) where.entity = args.entity;
    if (args.action) where.action = args.action;
    if (args.dateFrom || args.dateTo) {
      where.createdAt = {};
      if (args.dateFrom) where.createdAt.gte = args.dateFrom;
      if (args.dateTo) where.createdAt.lte = args.dateTo;
    }
    return where;
  }
}
