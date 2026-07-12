import type { AiRequestLog, Prisma, PrismaClient } from '@prisma/client';
import type { CreateAiRequestLogInput } from './ai-assistant.types.js';

type DbClient = PrismaClient | Prisma.TransactionClient;

// The ONLY place in the codebase allowed to touch the ai-assistant tables
// (ai_request_logs, material_reference_prices). Reading OTHER modules' data
// happens exclusively through their public services — never through Prisma
// here (binding rule #1).
export class AiAssistantRepository {
  constructor(private readonly prisma: PrismaClient) {}

  createRequestLog(
    data: CreateAiRequestLogInput,
    client: DbClient = this.prisma,
  ): Promise<AiRequestLog> {
    return client.aiRequestLog.create({
      data: {
        userId: data.userId,
        operationType: data.operationType,
        modelUsed: data.modelUsed,
        sourceModules: data.sourceModules,
        recordIds: data.recordIds,
        tokensPrompt: data.tokensPrompt,
        tokensCompletion: data.tokensCompletion,
        costUsd: data.costUsd,
        outputSummary: data.outputSummary,
        approvalState: data.approvalState ?? 'NONE',
      },
    });
  }
}
