// ============================================================
// Context Engine — resolves references ("previous estimate", "Villa Template",
// "Baghdad prices", "continue where we stopped") by combining the session,
// prior messages, existing records, and user preferences BEFORE the LLM.
//
// Phase 1 is a deliberate STUB: intra-tool references (e.g. the material-catalog
// match) are resolved by the tool itself, and the session already carries its
// working state + contextRefs. Full cross-entity/preference resolution is Phase
// 2 (with the Knowledge Base). The contract exists now so nothing bypasses it.
// ============================================================

import type { AiSession } from '@prisma/client';
import type { ParsedIntent, ResolvedContext } from '../ai-platform.types.js';

export class ContextEngine {
  async resolve(session: AiSession, _intent: ParsedIntent): Promise<ResolvedContext> {
    const refs = (session.contextRefs as Record<string, string> | null) ?? {};
    return { refs, preferences: {}, priorState: session.workingState ?? null };
  }
}
