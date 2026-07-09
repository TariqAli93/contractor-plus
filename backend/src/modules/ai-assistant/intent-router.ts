// ============================================================
// Intent Router — picks the target tool for a turn the conversation-mode
// classifier has already decided needs one (QUESTION, WORKFLOW, or COMMAND).
// Deterministic and cheap: no LLM call of its own.
//
// The mode does the discriminating, not a keyword scan of the text: estimation
// is only ever reached through a WORKFLOW turn, so "اعرض قوالب التقدير" is
// answered as the question it is instead of drafting a new template. Command is
// the default — it runs its own LLM classifier over the whole action registry.
// ============================================================

import type { AiSession } from '@prisma/client';
import type { ToolRegistry } from '../ai-platform/registry/tool-registry.js';
import type { ConversationMode } from './conversation-mode.js';
import { WORKFLOW_TOOL } from './workflow.js';

export interface RoutedIntent {
  targetTool: string | null;
  confidence: number;
}

export class IntentRouter {
  constructor(private readonly registry: ToolRegistry) {}

  route(session: AiSession, mode: ConversationMode): RoutedIntent {
    if (mode === 'WORKFLOW') {
      // A tool with a live draft keeps the turn — the user is refining it.
      if (session.activeTool && session.activeTool !== WORKFLOW_TOOL && session.workingState != null) {
        const active = this.registry.get(session.activeTool);
        if (active?.interpret) return { targetTool: active.name, confidence: 0.9 };
      }
      if (this.registry.get('estimation')?.interpret) return { targetTool: 'estimation', confidence: 0.85 };
    }

    // QUESTION / COMMAND → the command tool's own classifier handles the breadth.
    if (this.registry.get('command')?.interpret) return { targetTool: 'command', confidence: 0.9 };

    // Fallback → any NL-capable tool.
    const any = this.registry.list().find((t) => typeof t.interpret === 'function');
    return { targetTool: any?.name ?? null, confidence: any ? 0.6 : 0.2 };
  }
}
