import { useAuthStore } from '@/stores/auth.store';
import { RoleName } from '@/types/enums';

export interface AccessSpec {
  permissions?: readonly string[];
  roles?: readonly string[];
  mode?: 'any' | 'all';
}

// Centralized frontend access decisions. Mirrors the backend `requireAccess`
// hybrid: OWNER always passes; otherwise permission-first with a legacy-role
// fallback. UI only HIDES things - the backend remains authoritative.
export function useAccess() {
  const auth = useAuthStore();

  function hasRole(role: string): boolean {
    return auth.role === role;
  }

  function hasAnyRole(roles: readonly string[]): boolean {
    return auth.role != null && roles.includes(auth.role);
  }

  function hasPermission(key: string): boolean {
    if (auth.role === RoleName.OWNER) return true;
    return auth.permissions.includes(key);
  }

  function hasAnyPermission(keys: readonly string[]): boolean {
    if (auth.role === RoleName.OWNER) return true;
    return keys.some((k) => auth.permissions.includes(k));
  }

  function hasAllPermissions(keys: readonly string[]): boolean {
    if (auth.role === RoleName.OWNER) return true;
    return keys.every((k) => auth.permissions.includes(k));
  }

  function canAccess(spec: AccessSpec): boolean {
    if (auth.role === RoleName.OWNER) return true;
    if (spec.permissions && spec.permissions.length > 0) {
      const ok =
        (spec.mode ?? 'any') === 'all'
          ? hasAllPermissions(spec.permissions)
          : hasAnyPermission(spec.permissions);
      if (ok) return true;
    }
    if (spec.roles && spec.roles.length > 0 && auth.role && spec.roles.includes(auth.role)) {
      return true;
    }
    // No requirement at all → allow (authenticated).
    if (!spec.permissions?.length && !spec.roles?.length) return true;
    return false;
  }

  return { hasRole, hasAnyRole, hasPermission, hasAnyPermission, hasAllPermissions, canAccess };
}
