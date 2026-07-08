// ============================================================
// Tool Registry — the single allow-list of AI capabilities (generalizes
// ai-command's ACTIONS + getAction + buildActionCatalog). The intent parser /
// planner may only ever name a registered, permission-visible tool action.
// ============================================================

import type { PrismaClient } from '@prisma/client';
import type { PermissionDef } from '../../rbac/rbac.catalog.js';
import { createLlmClient, type LlmClient } from '../../../lib/llm/llm-client.js';
import { LlmSettingsStore } from '../../../lib/llm/llm-settings.store.js';
import { EstimationTemplatesService } from '../../estimation-templates/estimation-templates.service.js';
import { buildActionDeps } from '../../ai-command-workflow/ai-command-workflow.registry.js';
import { AiCommandRepository } from '../../ai-command-workflow/ai-command-workflow.repository.js';
import type { Tool, ToolAction, ToolDeps } from './tool.contract.js';

/** Build the domain-service bag threaded to every tool. Stateless (prisma-backed)
 *  services, so the orchestrator builds this ONCE and reuses it across turns.
 *  An injected LLM client (tests) is threaded to every tool that owns a domain
 *  LLM call; production tools resolve one from settings on demand. */
export function buildToolDeps(prisma: PrismaClient, llmClient?: LlmClient): ToolDeps {
  const llmSettings = new LlmSettingsStore(prisma);
  return {
    prisma,
    estimation: new EstimationTemplatesService(prisma, llmClient),
    command: {
      deps: buildActionDeps(prisma),
      repo: new AiCommandRepository(prisma),
      resolveClient: async () => {
        if (llmClient) return { client: llmClient, provider: llmClient.name };
        const cfg = await llmSettings.resolve();
        return { client: createLlmClient(cfg), provider: cfg.provider };
      },
    },
  };
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** Resolve a qualified "tool.action" name to its Tool + ToolAction. */
  getAction(qualified: string): { tool: Tool; action: ToolAction } | undefined {
    const dot = qualified.indexOf('.');
    if (dot === -1) return undefined;
    const tool = this.tools.get(qualified.slice(0, dot));
    if (!tool) return undefined;
    const action = tool.actions.find((a) => a.name === qualified.slice(dot + 1));
    return action ? { tool, action } : undefined;
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  /** The union of every tool's declared permissions — merged into the catalog. */
  contributedPermissions(): PermissionDef[] {
    return this.list().flatMap((t) => t.contributePermissions());
  }

  /** A compact, permission-filtered catalog for the intent parser / planner. */
  buildCatalog(perms: Set<string>): string {
    return this.list()
      .map((tool) => {
        const actions = tool.actions
          .filter((a) => a.requiredPermissions.every((p) => perms.has(p)))
          .map((a) => `  - ${tool.name}.${a.name} [${a.kind}] — ${a.description}`)
          .join('\n');
        return actions ? `${tool.name} (${tool.displayName}):\n${actions}` : '';
      })
      .filter(Boolean)
      .join('\n');
  }
}
