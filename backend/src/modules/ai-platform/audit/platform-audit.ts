// ============================================================
// Platform Audit — the unified AI trail. One AiExecution row per plan execution
// attempt (folds forward AiCommandLog + EstimationAuditLog content): original
// request, parsed intent, planner output, selected tools, approval, executed
// actions, transaction result, final data, confidence. Complements (does not
// replace) the per-entity AuditService.log rows a tool writes inside its tx.
// ============================================================

import type { AiExecution, Prisma, PrismaClient } from '@prisma/client';
import { toJsonValue } from '../../../shared/utils/json.js';

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface AiExecutionRecord {
  sessionId?: string | null;
  // Always the acting user — the column is NOT NULL (see schema).
  userId: string;
  toolName?: string | null;
  originalRequest: string;
  parsedIntent?: unknown;
  plannerOutput?: unknown;
  selectedTools?: unknown;
  userApproval?: unknown;
  executedActions?: unknown;
  finalData?: unknown;
  transactionResult: 'executed' | 'failed' | 'cancelled' | 'not_required';
  confidence?: number | null;
  provider?: string | null;
  failedReason?: string | null;
}

export class PlatformAudit {
  constructor(private readonly prisma: PrismaClient) {}

  record(rec: AiExecutionRecord, client: DbClient = this.prisma): Promise<AiExecution> {
    const data: Prisma.AiExecutionUncheckedCreateInput = {
      sessionId: rec.sessionId ?? null,
      userId: rec.userId,
      toolName: rec.toolName ?? null,
      originalRequest: rec.originalRequest,
      transactionResult: rec.transactionResult,
      confidence: rec.confidence ?? null,
      provider: rec.provider ?? null,
      failedReason: rec.failedReason ?? null,
    };
    if (rec.parsedIntent != null) data.parsedIntent = toJsonValue(rec.parsedIntent);
    if (rec.plannerOutput != null) data.plannerOutput = toJsonValue(rec.plannerOutput);
    if (rec.selectedTools != null) data.selectedTools = toJsonValue(rec.selectedTools);
    if (rec.userApproval != null) data.userApproval = toJsonValue(rec.userApproval);
    if (rec.executedActions != null) data.executedActions = toJsonValue(rec.executedActions);
    if (rec.finalData != null) data.finalData = toJsonValue(rec.finalData);
    return client.aiExecution.create({ data });
  }
}
