// ============================================================
// AI Session Manager — durable, DB-backed, multi-session, resumable across a
// restart (generalizes the estimation durable draft + replaces ai-command's
// in-memory SessionStore). Owns ownership checks, lazy-expiry-on-read, working
// state, and the parked-plan lifecycle.
// ============================================================

import { Prisma } from '@prisma/client';
import type { AiMessage, AiSession, PrismaClient } from '@prisma/client';
import { SessionRepository } from './session.repository.js';
import { NotFoundError } from '../../../shared/errors/not-found.error.js';
import { ConflictError } from '../../../shared/errors/conflict.error.js';
import type { Plan } from '../ai-platform.types.js';

type DbClient = PrismaClient | Prisma.TransactionClient;

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export interface NewMessage {
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  kind: string;
  content: string;
  toolName?: string | null;
  intent?: unknown;
  plan?: unknown;
  confidence?: number | null;
}

function nextExpiry(): Date {
  return new Date(Date.now() + SESSION_TTL_MS);
}
function isTerminal(s: AiSession): boolean {
  return (
    s.status === 'COMPLETED' || s.status === 'CANCELLED' || s.status === 'EXPIRED' || s.status === 'FAILED'
  );
}

export class SessionManager {
  private readonly repo: SessionRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repo = new SessionRepository(prisma);
  }

  open(userId: string, title?: string | null): Promise<AiSession> {
    return this.repo.createSession({
      userId,
      title: title ?? null,
      status: 'ACTIVE',
      contextRefs: {},
      expiresAt: nextExpiry(),
    });
  }

  list(userId: string): Promise<AiSession[]> {
    return this.repo.listByUser(userId);
  }

  messages(sessionId: string): Promise<AiMessage[]> {
    return this.repo.listMessages(sessionId);
  }

  /** Load a session owned by the caller. Lazily flips a stale non-terminal
   *  session to EXPIRED; `requireActive` then rejects it. */
  async load(sessionId: string, userId: string, requireActive: boolean): Promise<AiSession> {
    const session = await this.repo.findById(sessionId);
    if (!session || session.userId !== userId || session.deletedAt) {
      throw new NotFoundError('Session', 'SESSION_NOT_FOUND');
    }
    if (!isTerminal(session) && session.expiresAt.getTime() < Date.now()) {
      const expired = await this.repo.updateSession(session.id, { status: 'EXPIRED' });
      if (requireActive) throw new ConflictError('Session has expired', 'SESSION_EXPIRED');
      return expired;
    }
    if (requireActive && session.status === 'EXPIRED') {
      throw new ConflictError('Session has expired', 'SESSION_EXPIRED');
    }
    return session;
  }

  appendMessage(session: AiSession, msg: NewMessage, client?: DbClient): Promise<AiMessage> {
    return this.repo.appendMessage(
      {
        sessionId: session.id,
        role: msg.role,
        kind: msg.kind,
        content: msg.content,
        toolName: msg.toolName ?? null,
        intent: (msg.intent ?? undefined) as Prisma.InputJsonValue | undefined,
        plan: (msg.plan ?? undefined) as Prisma.InputJsonValue | undefined,
        confidence: msg.confidence ?? null,
      },
      client,
    );
  }

  saveWorkingState(
    session: AiSession,
    toolName: string,
    state: unknown,
    confidence?: number,
    client?: DbClient,
  ): Promise<AiSession> {
    return this.repo.updateSession(
      session.id,
      {
        activeTool: toolName,
        workingState: (state ?? undefined) as Prisma.InputJsonValue | undefined,
        ...(confidence !== undefined ? { confidence } : {}),
        expiresAt: nextExpiry(),
      },
      client,
    );
  }

  parkPlan(session: AiSession, plan: Plan): Promise<AiSession> {
    return this.repo.updateSession(session.id, {
      pendingPlan: plan as unknown as Prisma.InputJsonValue,
      status: 'AWAITING_CONFIRMATION',
      expiresAt: nextExpiry(),
    });
  }

  clearPlan(session: AiSession): Promise<AiSession> {
    return this.repo.updateSession(session.id, { pendingPlan: Prisma.JsonNull, status: 'ACTIVE' });
  }

  complete(session: AiSession, client?: DbClient): Promise<AiSession> {
    return this.repo.updateSession(
      session.id,
      { status: 'COMPLETED', confirmedAt: new Date(), pendingPlan: Prisma.JsonNull },
      client,
    );
  }

  cancel(session: AiSession): Promise<AiSession> {
    return this.repo.updateSession(session.id, {
      status: 'CANCELLED',
      cancelledAt: new Date(),
      pendingPlan: Prisma.JsonNull,
    });
  }

  markFailed(session: AiSession): Promise<AiSession> {
    return this.repo.updateSession(session.id, { status: 'FAILED' });
  }
}
