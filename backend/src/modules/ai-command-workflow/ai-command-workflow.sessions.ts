// ============================================================
// Session store — in-memory, TTL-bounded conversational state.
//
// Holds the short-lived context for a multi-turn command: the pending intent,
// collected/missing slots, and a resolved plan awaiting confirmation. A single
// desktop backend instance runs the service, so an in-memory Map is sufficient;
// a pending plan intentionally does not survive a restart (the user re-issues).
// ============================================================

import { randomUUID } from 'node:crypto';
import type { Session } from './ai-command-workflow.types.js';

const TTL_MS = 10 * 60 * 1000; // 10 minutes
const SWEEP_INTERVAL_MS = 60 * 1000; // reclaim idle sessions every minute

export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly sweepTimer: ReturnType<typeof setInterval>;

  /** An independent sweep reclaims expired sessions even when NO request arrives
   *  to trigger the on-access sweep (otherwise an abandoned session lingers in
   *  memory until the next unrelated request). `unref()` so the timer never keeps
   *  the process alive. */
  constructor(sweepIntervalMs: number = SWEEP_INTERVAL_MS) {
    this.sweepTimer = setInterval(() => this.sweep(), sweepIntervalMs);
    if (typeof this.sweepTimer.unref === 'function') this.sweepTimer.unref();
  }

  /** Stop the background sweep (for tests / graceful teardown). */
  stop(): void {
    clearInterval(this.sweepTimer);
  }

  /** Current live-session count WITHOUT triggering an on-access sweep — lets a
   *  test observe what the background timer reclaimed on its own. */
  size(): number {
    return this.sessions.size;
  }

  /** Fetch a live session for this user, or create a fresh one. A sessionId that
   *  is unknown, expired, or owned by another user yields a brand-new session. */
  resolve(sessionId: string | undefined, userId: string, originalText: string): Session {
    this.sweep();
    if (sessionId) {
      const existing = this.sessions.get(sessionId);
      if (existing && existing.userId === userId && existing.expiresAt > Date.now()) {
        existing.originalText = originalText;
        return existing;
      }
    }
    return this.create(userId, originalText);
  }

  create(userId: string, originalText: string): Session {
    const now = Date.now();
    const session: Session = {
      sessionId: randomUUID(),
      userId,
      pendingIntent: null,
      collectedSlots: {},
      missingSlots: [],
      pendingPlan: null,
      originalText,
      createdAt: now,
      expiresAt: now + TTL_MS,
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  /** Read a session (for the GET endpoint / confirm), or null if gone/expired. */
  get(sessionId: string, userId?: string): Session | null {
    this.sweep();
    const s = this.sessions.get(sessionId);
    if (!s || s.expiresAt <= Date.now()) return null;
    if (userId && s.userId !== userId) return null;
    return s;
  }

  /** Persist mutations to a session and slide its TTL forward. */
  save(session: Session): void {
    session.expiresAt = Date.now() + TTL_MS;
    this.sessions.set(session.sessionId, session);
  }

  /** Clear the pending plan/intent but keep the session alive. */
  clearPending(session: Session): void {
    session.pendingIntent = null;
    session.pendingPlan = null;
    session.missingSlots = [];
    session.collectedSlots = {};
    this.save(session);
  }

  drop(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (s.expiresAt <= now) this.sessions.delete(id);
    }
  }
}
