import type { NavigationGuardWithThis } from 'vue-router';
import { useAuthStore } from '@/stores/auth.store';
import type { RoleName } from '@/types/enums';

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

export const requireRole: NavigationGuardWithThis<undefined> = (to) => {
  const required = to.meta.requiredRoles as RoleName[] | undefined;
  if (!required || required.length === 0) return true;
  const auth = useAuthStore();
  const role = auth.role;
  if (!role || !required.includes(role)) {
    return { name: 'dashboard' };
  }
  return true;
};
