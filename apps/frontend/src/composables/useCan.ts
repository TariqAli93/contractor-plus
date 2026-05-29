import { computed } from 'vue';
import { useAuthStore } from '@/stores/auth.store';
import type { RoleName } from '@/types/enums';

export function useCan() {
  const auth = useAuthStore();

  function can(allowed: RoleName[]): boolean {
    const role = auth.role;
    if (!role) return false;
    return allowed.includes(role);
  }

  const isAuthenticated = computed(() => auth.isAuthenticated);

  return { can, isAuthenticated };
}
