// ============================================================
// Intent Parser — identifies the user's objective + target tool WITHOUT
// executing. Separated from planning/execution by contract.
//
// Phase 1 routing: there is one NL-capable tool (Estimation), so parsing routes
// to it (or to the session's already-active tool). When domain tools land
// (Phase 3), this becomes an LLM classification over the permission-filtered
// registry catalog — the contract and call site do not change.
// ============================================================

import type { AiSession } from '@prisma/client';
import type { ToolRegistry } from '../registry/tool-registry.js';
import type { ParsedIntent } from '../ai-platform.types.js';

export class IntentParser {
  constructor(private readonly registry: ToolRegistry) {}

  parse(session: AiSession, _text: string): ParsedIntent {
    const active = session.activeTool ? this.registry.get(session.activeTool) : undefined;
    const tool = active ?? this.registry.list().find((t) => typeof t.interpret === 'function');
    return {
      objective: tool ? `${tool.name}.interpret` : 'unknown',
      targetTool: tool?.name ?? null,
      entities: {},
      missingInfo: [],
      confidence: tool ? 0.9 : 0.2,
    };
  }
}
