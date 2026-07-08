// ============================================================
// Permission Validator — the fine-grained half of the dual-layer gate
// (generalizes ai-command's assertAllRegistered + assertPermitted). The coarse
// half is the `ai.session.use` route preHandler; this re-checks EVERY plan
// step's action permissions at execute-time, so a permission revoked between
// preview and confirm fails closed.
// ============================================================

import { ValidationError } from '../../../shared/errors/validation.error.js';
import { ForbiddenError } from '../../../shared/errors/forbidden.error.js';
import type { ToolRegistry } from '../registry/tool-registry.js';
import type { PlatformContext } from '../registry/tool.contract.js';
import type { Plan } from '../ai-platform.types.js';

/** The registry key for a step: `${toolName}.${action}`. */
export function qualify(step: { toolName: string; action: string }): string {
  return `${step.toolName}.${step.action}`;
}

export function assertRegistered(plan: Plan, registry: ToolRegistry): void {
  for (const step of plan.steps) {
    if (!registry.getAction(qualify(step))) {
      throw new ValidationError(`إجراء غير مُسجّل: ${qualify(step)}`, { action: ['unregistered'] });
    }
  }
}

export function assertPermitted(plan: Plan, ctx: PlatformContext, registry: ToolRegistry): void {
  for (const step of plan.steps) {
    const resolved = registry.getAction(qualify(step));
    if (!resolved) continue;
    const missing = resolved.action.requiredPermissions.filter((p) => !ctx.permissions.has(p));
    if (missing.length > 0) {
      throw new ForbiddenError(
        `لا تملك صلاحية تنفيذ "${qualify(step)}" (${missing.join(', ')})`,
        'INSUFFICIENT_PERMISSION',
      );
    }
  }
}
