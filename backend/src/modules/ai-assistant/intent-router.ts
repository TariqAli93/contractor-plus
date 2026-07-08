// ============================================================
// Intent Router — picks the target tool for a passthrough turn (after the
// pre-router has ruled out help/greeting/status/confirm/cancel). Deterministic
// and cheap: no LLM call of its own. Command is the default because it runs its
// own LLM classifier over the whole action registry; estimation is the
// specialist, reached on strong, specific signals or when its draft is in flight.
// ============================================================

import type { AiSession } from '@prisma/client';
import { normalizeArabic } from '../ai-command-workflow/ai-command-workflow.arabic.js';
import type { ToolRegistry } from '../ai-platform/registry/tool-registry.js';

export interface RoutedIntent {
  targetTool: string | null;
  confidence: number;
}

// Deliberately narrow, estimation-specific signals so ordinary command phrasing
// (e.g. "كم كلفة مشروع كذا" → an expense query) is NOT misrouted to the estimator.
const ESTIMATION_HINTS = ['تقدير', 'قالب', 'كميات', 'estimate', 'estimation', 'template'].map(normalizeArabic);

export class IntentRouter {
  constructor(private readonly registry: ToolRegistry) {}

  route(session: AiSession, text: string): RoutedIntent {
    // 1) A tool with durable working state (an estimation draft mid-flight) keeps
    //    the turn — the user is continuing that conversation.
    if (session.activeTool && session.workingState != null) {
      const active = this.registry.get(session.activeTool);
      if (active?.interpret) return { targetTool: active.name, confidence: 0.9 };
    }

    // 2) Estimation on strong signals.
    const norm = normalizeArabic(text);
    if (this.registry.get('estimation')?.interpret && ESTIMATION_HINTS.some((h) => norm.includes(h))) {
      return { targetTool: 'estimation', confidence: 0.85 };
    }

    // 3) Default → command (its own LLM classifier handles the domain breadth).
    if (this.registry.get('command')?.interpret) return { targetTool: 'command', confidence: 0.9 };

    // 4) Fallback → any NL-capable tool.
    const any = this.registry.list().find((t) => typeof t.interpret === 'function');
    return { targetTool: any?.name ?? null, confidence: any ? 0.6 : 0.2 };
  }
}
