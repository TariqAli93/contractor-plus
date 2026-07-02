// ============================================================
// Permission Engine — المرحلة التاسعة.
//
// Validates that the principal may run EVERY step of a plan before anything is
// confirmed or executed. Mirrors the backend RBAC semantics exactly: OWNER is
// all-allowed; everyone else must hold each required permission key. The HTTP
// route guard still gates entry (`voice.use`); this is the per-ACTION gate so a
// voice command can never perform something the user couldn't do via the UI.
// ============================================================

import { RoleName } from '@contractor-plus/shared';
import type { Plan, VoicePrincipal } from './voice.types.js';

export interface PermissionVerdict {
  allowed: boolean;
  missing: string[];
}

export class PermissionEngine {
  evaluate(plan: Plan, principal: VoicePrincipal): PermissionVerdict {
    if (principal.role === RoleName.OWNER) return { allowed: true, missing: [] };

    const required = new Set<string>(plan.requiredPermissions);
    for (const step of plan.steps) {
      for (const key of step.requiredPermissions) required.add(key);
    }

    const missing = [...required].filter((key) => !principal.permissions.has(key));
    return { allowed: missing.length === 0, missing };
  }
}
