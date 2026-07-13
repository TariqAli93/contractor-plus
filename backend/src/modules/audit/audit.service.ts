import type { AuditAction, Prisma, PrismaClient } from '@prisma/client';
import { AuditRepository } from './audit.repository.js';
import { NotFoundError } from '../../shared/errors/not-found.error.js';
import { buildPaginated, toSkipTake } from '../../shared/utils/pagination.js';
import type { Paginated } from '../../shared/types/pagination.js';
import type {
  EntityHistoryQuery,
  ListAuditLogsQuery,
  UserHistoryQuery,
} from './audit.schemas.js';
import type { AuditLogWithUser } from './audit.types.js';

export interface AuditActor {
  // `null` attributes a system/scheduled action (e.g. the material-price sync
  // job). The AuditLog.userId column is nullable; human callers always pass a
  // real id, so widening this is backward-compatible.
  userId: string | null;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Narrow an actor to a concrete user id for records that CANNOT be
 * system-authored (e.g. AiRequestLog.userId is non-nullable — every provider
 * call is user-initiated). Throws rather than silently writing a bad FK.
 */
export function requireUserId(actor: AuditActor): string {
  if (actor.userId === null) {
    throw new Error('a user-attributed action was reached with a system actor');
  }
  return actor.userId;
}

export interface AuditLogInput {
  action: AuditAction;
  entity: string;
  entityId: string;
  oldValues?: Prisma.InputJsonValue;
  newValues?: Prisma.InputJsonValue;
}

type DbClient = PrismaClient | Prisma.TransactionClient;

// Audit logs are append-only. This service exposes ONE write method (log) used
// by every other module inside its own transaction, plus read methods for the
// /audit endpoints. There is no update or delete — historical entries are
// immutable. Soft-deleting a domain row leaves its audit trail intact.
export class AuditService {
  private readonly repo: AuditRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new AuditRepository(prisma);
  }

  // ---------- Write (used by other modules' transactions) ----------

  async log(actor: AuditActor, input: AuditLogInput, client: DbClient = this.prisma): Promise<void> {
    await client.auditLog.create({
      data: {
        userId: actor.userId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        oldValues: input.oldValues,
        newValues: input.newValues,
      },
    });
  }

  // ---------- Read (used by /audit endpoints) ----------

  async listLogs(query: ListAuditLogsQuery): Promise<Paginated<AuditLogWithUser>> {
    const { skip, take } = toSkipTake(query);
    const [items, total] = await Promise.all([
      this.repo.findMany({
        entity: query.entity,
        entityId: query.entityId,
        action: query.action,
        userId: query.userId,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        skip,
        take,
        sortDir: query.sortDir,
      }),
      this.repo.count({
        entity: query.entity,
        entityId: query.entityId,
        action: query.action,
        userId: query.userId,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      }),
    ]);
    return buildPaginated(items, total, query);
  }

  async getLogById(id: string): Promise<AuditLogWithUser> {
    const log = await this.repo.findById(id);
    if (!log) throw new NotFoundError('Audit log', 'AUDIT_LOG_NOT_FOUND');
    return log;
  }

  async getEntityHistory(
    entity: string,
    entityId: string,
    query: EntityHistoryQuery,
  ): Promise<Paginated<AuditLogWithUser>> {
    const { skip, take } = toSkipTake(query);
    const [items, total] = await Promise.all([
      this.repo.findEntityHistory({ entity, entityId, skip, take, sortDir: query.sortDir }),
      this.repo.countEntityHistory(entity, entityId),
    ]);
    return buildPaginated(items, total, query);
  }

  async getUserHistory(
    userId: string,
    query: UserHistoryQuery,
  ): Promise<Paginated<AuditLogWithUser>> {
    const { skip, take } = toSkipTake(query);
    const [items, total] = await Promise.all([
      this.repo.findUserHistory({
        userId,
        entity: query.entity,
        action: query.action,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        skip,
        take,
        sortDir: query.sortDir,
      }),
      this.repo.countUserHistory({
        userId,
        entity: query.entity,
        action: query.action,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      }),
    ]);
    return buildPaginated(items, total, query);
  }
}
