// ============================================================
// Session data access — AiSession + AiMessage. Every write accepts an optional
// tx client (the repo pattern used across the codebase) so the executor can fold
// a message/session update into its confirm transaction.
// ============================================================

import type { AiMessage, AiSession, Prisma, PrismaClient } from '@prisma/client';

type DbClient = PrismaClient | Prisma.TransactionClient;

export class SessionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  createSession(
    data: Prisma.AiSessionUncheckedCreateInput,
    client: DbClient = this.prisma,
  ): Promise<AiSession> {
    return client.aiSession.create({ data });
  }

  findById(id: string, client: DbClient = this.prisma): Promise<AiSession | null> {
    return client.aiSession.findUnique({ where: { id } });
  }

  updateSession(
    id: string,
    data: Prisma.AiSessionUncheckedUpdateInput,
    client: DbClient = this.prisma,
  ): Promise<AiSession> {
    return client.aiSession.update({ where: { id }, data });
  }

  listByUser(userId: string, client: DbClient = this.prisma): Promise<AiSession[]> {
    return client.aiSession.findMany({
      where: { userId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
  }

  appendMessage(
    data: Prisma.AiMessageUncheckedCreateInput,
    client: DbClient = this.prisma,
  ): Promise<AiMessage> {
    return client.aiMessage.create({ data });
  }

  listMessages(sessionId: string, client: DbClient = this.prisma): Promise<AiMessage[]> {
    return client.aiMessage.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } });
  }
}
