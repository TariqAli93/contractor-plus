import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { UserProfile } from '@/types/auth';
import type { RoleName } from '@/types/enums';
import { tokenStorage } from '@/lib/token-storage';
import { authApi } from '@/services/api/auth.api';

export const useAuthStore = defineStore('auth', () => {
  const accessToken = ref<string | null>(null);
  const user = ref<UserProfile | null>(null);
  const initialized = ref(false);

  const isAuthenticated = computed(() => accessToken.value !== null && user.value !== null);
  const role = computed<RoleName | null>(() => user.value?.role ?? null);

  function setSession(payload: {
    accessToken: string;
    refreshToken: string;
    user: UserProfile;
  }) {
    accessToken.value = payload.accessToken;
    user.value = payload.user;
    tokenStorage.setRefreshToken(payload.refreshToken);
  }

  function setTokensOnly(payload: { accessToken: string; refreshToken: string }) {
    accessToken.value = payload.accessToken;
    tokenStorage.setRefreshToken(payload.refreshToken);
  }

  function clear() {
    accessToken.value = null;
    user.value = null;
    tokenStorage.clearRefreshToken();
  }

  async function login(email: string, password: string): Promise<void> {
    const res = await authApi.login({ email, password });
    setSession({
      accessToken: res.tokens.accessToken,
      refreshToken: res.tokens.refreshToken,
      user: res.user,
    });
  }

  async function logout(): Promise<void> {
    const refreshToken = tokenStorage.getRefreshToken();
    try {
      if (refreshToken) await authApi.logout({ refreshToken });
    } catch {
      /* best-effort; clear local state regardless */
    }
    clear();
  }

  // Called once on app boot from main.ts.
  async function initialize(): Promise<void> {
    if (initialized.value) return;
    const refreshToken = tokenStorage.getRefreshToken();
    if (!refreshToken) {
      initialized.value = true;
      return;
    }
    try {
      const tokens = await authApi.refresh({ refreshToken });
      setTokensOnly({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      });
      // Pull user profile separately (refresh endpoint returns tokens only).
      user.value = await authApi.me();
    } catch {
      clear();
    } finally {
      initialized.value = true;
    }
  }

  return {
    accessToken,
    user,
    initialized,
    isAuthenticated,
    role,
    setSession,
    setTokensOnly,
    clear,
    login,
    logout,
    initialize,
  };
});
