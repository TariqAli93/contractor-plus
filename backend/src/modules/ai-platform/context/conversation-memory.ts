// ============================================================
// Conversation Memory — prior turns of the active session, so the assistant
// never asks the user to repeat context. Phase 1: a windowed history + a compact
// preamble. (Tools that own their own durable working state — like Estimation's
// draft — primarily continue from that; the preamble is supplementary context.)
// ============================================================

import type { AiMessage, AiSession } from '@prisma/client';
import type { SessionManager } from '../session/session.manager.js';

export class ConversationMemory {
  constructor(private readonly manager: SessionManager) {}

  history(session: AiSession, window = 10): Promise<AiMessage[]> {
    return this.manager.messages(session.id).then((all) => all.slice(-window));
  }

  async buildPreamble(session: AiSession): Promise<string> {
    const msgs = await this.history(session, 8);
    if (msgs.length === 0) return '';
    return msgs.map((m) => `${m.role}: ${m.content}`).join('\n');
  }
}
