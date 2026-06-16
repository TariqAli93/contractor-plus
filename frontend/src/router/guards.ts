import type { NavigationGuardWithThis } from 'vue-router';
import { useAuthStore } from '@/stores/auth.store';
import { useSetupStore } from '@/stores/setup.store';
import { useAccess, type AccessSpec } from '@/composables/useAccess';

// First-run setup gate (desktop only). Runs before auth:
//   - desktop + setup incomplete  → force the wizard (/setup).
//   - desktop + setup complete     → /setup is off-limits (send to login).
//   - web (no window.desktop)       → /setup is off-limits; everything else passes.
export const requireSetup: NavigationGuardWithThis<undefined> = (to) => {
  const setup = useSetupStore();
  if (!setup.isDesktop) {
    return to.name === 'setup' ? { name: 'login' } : true;
  }
  if (!setup.setupComplete && to.name !== 'setup') {
    return { name: 'setup' };
  }
  if (setup.setupComplete && to.name === 'setup') {
    return { name: 'login' };
  }
  return true;
};

export const requireAuth: NavigationGuardWithThis<undefined> = (to) => {
  const auth = useAuthStore();
  if (to.meta.public) return true;
  if (!auth.isAuthenticated) {
    return {
      name: 'login',
      query: to.fullPath !== '/' ? { redirect: to.fullPath } : undefined,
    };
  }
  return true;
};

// Hybrid access guard. A route declares access via `meta.access`
// ({ permissions?, roles?, mode? }); legacy `meta.requiredPermissions` /
// `meta.requiredRoles` are still honored. Decisions are centralized in
// useAccess (OWNER always; permission-first; legacy-role fallback).
export const requireRole: NavigationGuardWithThis<undefined> = (to) => {
  const access = to.meta.access as AccessSpec | undefined;
  const legacyPermissions = to.meta.requiredPermissions as string[] | undefined;
  const legacyRoles = to.meta.requiredRoles as string[] | undefined;

  const spec: AccessSpec = access ?? { permissions: legacyPermissions, roles: legacyRoles };
  const hasReq = Boolean(spec.permissions?.length) || Boolean(spec.roles?.length);
  if (!hasReq) return true;

  const { canAccess } = useAccess();
  return canAccess(spec) ? true : { name: 'dashboard' };
};
