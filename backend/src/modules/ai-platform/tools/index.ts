// ============================================================
// Tool registration — the single place every AI capability is wired onto the
// platform. Adding a capability later is one import + one register() call.
// ============================================================

import { ToolRegistry } from '../registry/tool-registry.js';
import type { RuleEngine } from '../rules/rule-engine.js';
import { EstimationTool } from './estimation/estimation.tool.js';

export function buildRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(EstimationTool);
  return registry;
}

/** Register every tool's deterministic rules into the shared rule engine. */
export function registerToolRules(engine: RuleEngine, registry: ToolRegistry): void {
  for (const tool of registry.list()) {
    if (tool.rules) engine.registerAll(tool.rules);
  }
}
