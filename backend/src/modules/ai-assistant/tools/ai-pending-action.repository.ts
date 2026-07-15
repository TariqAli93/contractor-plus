import type {
  AiPendingAction,
  AiPendingActionStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface CreatePendingActionInput {
  userId: string;
  toolName: string;
  argumentsJson: Prisma.InputJsonValue;
  previewJson: Prisma.InputJsonValue;
  idempotencyKey: string;
  expiresAt: Date;
}

// Owns the ai_pending_actions table (a new ai-assistant table). Reading/writing
// any OTHER module's data still goes through that module's public service — this
// repo never touches domain tables (binding rule #1).
export class AiPendingActionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  create(data: CreatePendingActionInput, client: DbClient = this.prisma): Promise<AiPendingAction> {
    return client.aiPendingAction.create({
      data: {
        userId: data.userId,
        toolName: data.toolName,
        argumentsJson: data.argumentsJson,
        previewJson: data.previewJson,
        idempotencyKey: data.idempotencyKey,
        expiresAt: data.expiresAt,
      },
    });
  }

  /** Owner-scoped fetch (a wrong userId simply yields null). */
  findForUser(
    id: string,
    userId: string,
    client: DbClient = this.prisma,
  ): Promise<AiPendingAction | null> {
    return client.aiPendingAction.findFirst({ where: { id, userId } });
  }

  listPendingForUser(userId: string, client: DbClient = this.prisma): Promise<AiPendingAction[]> {
    return client.aiPendingAction.findMany({
      where: { userId, status: 'PENDING', expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /**
   * Atomically claim a PENDING action for execution: PENDING → CONFIRMED, but
   * ONLY when it is still PENDING and unexpired. Returns the row on success, or
   * null when it was already processed / expired — THE double-execute guard.
   */
  async claimForExecution(
    id: string,
    userId: string,
    now: Date,
    client: DbClient = this.prisma,
  ): Promise<AiPendingAction | null> {
    const res = await client.aiPendingAction.updateMany({
      where: { id, userId, status: 'PENDING', expiresAt: { gt: now } },
      data: { status: 'CONFIRMED', confirmedAt: now },
    });
    if (res.count === 0) return null;
    return client.aiPendingAction.findUnique({ where: { id } });
  }

  markExecuted(
    id: string,
    resultRecordId: string | null,
    now: Date,
    client: DbClient = this.prisma,
  ): Promise<AiPendingAction> {
    return client.aiPendingAction.update({
      where: { id },
      data: { status: 'EXECUTED', resultRecordId, executedAt: now },
    });
  }

  markFailed(id: string, errorCode: string, client: DbClient = this.prisma): Promise<AiPendingAction> {
    return client.aiPendingAction.update({
      where: { id },
      data: { status: 'FAILED', errorCode },
    });
  }

  /** Owner-scoped reject: PENDING → REJECTED. Returns affected count (0 = not rejectable). */
  async reject(id: string, userId: string, client: DbClient = this.prisma): Promise<number> {
    const res = await client.aiPendingAction.updateMany({
      where: { id, userId, status: 'PENDING' },
      data: { status: 'REJECTED' },
    });
    return res.count;
  }

  setStatus(
    id: string,
    status: AiPendingActionStatus,
    client: DbClient = this.prisma,
  ): Promise<AiPendingAction> {
    return client.aiPendingAction.update({ where: { id }, data: { status } });
  }
}
