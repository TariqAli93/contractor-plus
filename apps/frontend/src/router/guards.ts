import type { NavigationGuardWithThis } from 'vue-router';
import { useAuthStore } from '@/stores/auth.store';
import { useAccess, type AccessSpec } from '@/composables/useAccess';

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
