// ============================================================
// Audit query — the read side of the unified AI trail. Because every turn now
// flows through the one orchestrator, ALL categories (command, estimation,
// query) land in a single AiExecution table; this service serves the audit panel
// with filtering by user / tool / result / date. All filter columns are indexed
// (schema.prisma), so no new migration is needed.
// ============================================================

import type { Prisma, PrismaClient } from '@prisma/client';
import type { AiExecutionListResult, AiExecutionQuery, AiExecutionView } from '@contractor-plus/shared';

const MAX_LIMIT = 100;

export class AuditQueryService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(q: AiExecutionQuery): Promise<AiExecutionListResult> {
    const where: Prisma.AiExecutionWhereInput = {};
    if (q.userId) where.userId = q.userId;
    if (q.toolName) where.toolName = q.toolName;
    if (q.transactionResult) where.transactionResult = q.transactionResult;
    if (q.from || q.to) {
      const range: Prisma.DateTimeFilter = {};
      if (q.from) range.gte = new Date(q.from);
      if (q.to) range.lte = new Date(q.to);
      where.createdAt = range;
    }

    const take = Math.min(Math.max(q.limit ?? 50, 1), MAX_LIMIT);
    const skip = Math.max(q.offset ?? 0, 0);

    const [rows, total] = await Promise.all([
      this.prisma.aiExecution.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        include: { user: { select: { fullName: true, username: true } } },
      }),
      this.prisma.aiExecution.count({ where }),
    ]);

    return {
      total,
      items: rows.map(
        (r): AiExecutionView => ({
          id: r.id,
          sessionId: r.sessionId,
          userId: r.userId,
          userName: r.user?.fullName ?? r.user?.username ?? null,
          toolName: r.toolName,
          originalRequest: r.originalRequest,
          transactionResult: r.transactionResult,
          confidence: r.confidence,
          failedReason: r.failedReason,
          executedActions: r.executedActions,
          createdAt: r.createdAt.toISOString(),
        }),
      ),
    };
  }
}
