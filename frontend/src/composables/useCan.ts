import { computed } from 'vue';
import { useAuthStore } from '@/stores/auth.store';

export function useCan() {
  const auth = useAuthStore();

  // Legacy role check (still used by un-migrated UI). `allowed` are role-name
  // strings; RoleName[] is assignable.
  function can(allowed: readonly string[]): boolean {
    const role = auth.role;
    if (!role) return false;
    return allowed.includes(role);
  }

  const isAuthenticated = computed(() => auth.isAuthenticated);

  return { can, isAuthenticated };
}
