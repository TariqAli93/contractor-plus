// ============================================================
// Voice persistence — sessions + immutable command log (المرحلة الرابعة عشرة).
//
// Pure Prisma access. Each method accepts an optional transaction client so the
// command-log write can be made atomic with the domain mutation it records.
// ============================================================

import {
  VoiceCommandStatus,
  VoiceSessionStatus,
  type Prisma,
  type PrismaClient,
  type VoiceCommandLog,
  type VoiceSession,
} from '@prisma/client';
import { toJsonValue } from '../../shared/utils/json.js';
import type { StoredSessionContext } from './voice.types.js';

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface CommandLogInput {
  sessionId: string;
  userId: string;
  transcript: string;
  normalized?: string;
  intent: string;
  confidence: number;
  entities?: unknown;
  plan?: unknown;
  status: VoiceCommandStatus;
  resultMessage?: string;
  createdEntities?: unknown;
  errorCode?: string;
  errorMessage?: string;
  provider?: string;
}

export class VoiceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  createSession(userId: string, locale: string, client: DbClient = this.prisma): Promise<VoiceSession> {
    return client.voiceSession.create({
      data: { userId, locale, status: VoiceSessionStatus.ACTIVE, context: {} },
    });
  }

  findSession(
    id: string,
    userId: string,
    client: DbClient = this.prisma,
  ): Promise<VoiceSession | null> {
    return client.voiceSession.findFirst({
      where: { id, userId, status: VoiceSessionStatus.ACTIVE },
    });
  }

  updateContext(
    id: string,
    context: StoredSessionContext,
    client: DbClient = this.prisma,
  ): Promise<VoiceSession> {
    return client.voiceSession.update({
      where: { id },
      data: { context: toJsonValue(context) },
    });
  }

  closeSession(id: string, client: DbClient = this.prisma): Promise<VoiceSession> {
    return client.voiceSession.update({
      where: { id },
      data: { status: VoiceSessionStatus.CLOSED, closedAt: new Date() },
    });
  }

  logCommand(input: CommandLogInput, client: DbClient = this.prisma): Promise<VoiceCommandLog> {
    return client.voiceCommandLog.create({
      data: {
        sessionId: input.sessionId,
        userId: input.userId,
        transcript: input.transcript,
        normalized: input.normalized,
        intent: input.intent,
        confidence: input.confidence,
        entities: input.entities === undefined ? undefined : toJsonValue(input.entities),
        plan: input.plan === undefined ? undefined : toJsonValue(input.plan),
        status: input.status,
        resultMessage: input.resultMessage,
        createdEntities:
          input.createdEntities === undefined ? undefined : toJsonValue(input.createdEntities),
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        provider: input.provider,
      },
    });
  }
}
