import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { UserProfile } from '@/types/auth';
import { RoleName } from '@/types/enums';
import { readXsrfToken } from '@/lib/csrf';
import { authApi } from '@/services/api/auth.api';

export const useAuthStore = defineStore('auth', () => {
  const accessToken = ref<string | null>(null);
  const user = ref<UserProfile | null>(null);
  const initialized = ref(false);

  const isAuthenticated = computed(() => accessToken.value !== null && user.value !== null);
  const role = computed<string | null>(() => user.value?.role ?? null);
  const isOwner = computed(() => role.value === RoleName.OWNER);
  const permissions = computed<string[]>(() => user.value?.permissions ?? []);

  // The refresh token lives in an HttpOnly cookie the browser manages for us; the
  // store only ever holds the in-memory access token and the user profile.
  function setSession(payload: { accessToken: string; user: UserProfile }) {
    accessToken.value = payload.accessToken;
    user.value = payload.user;
  }

  function setTokensOnly(payload: { accessToken: string }) {
    accessToken.value = payload.accessToken;
  }

  function clear() {
    accessToken.value = null;
    user.value = null;
  }

  async function login(username: string, password: string): Promise<void> {
    const res = await authApi.login({ username, password });
    setSession({ accessToken: res.tokens.accessToken, user: res.user });
  }

  async function logout(): Promise<void> {
    try {
      // The cookie carries the refresh token; the server revokes it and clears
      // all auth cookies. Best-effort - we clear local state regardless.
      await authApi.logout();
    } catch {
      /* ignore */
    }
    clear();
  }

  // Called once on app boot from main.ts.
  async function initialize(): Promise<void> {
    if (initialized.value) return;
    // No CSRF cookie ⇒ no prior session to restore. Mirrors the old "no stored
    // refresh token" fast-path and avoids a guaranteed-to-fail refresh call.
    if (!readXsrfToken()) {
      initialized.value = true;
      return;
    }
    try {
      const tokens = await authApi.refresh();
      setTokensOnly({ accessToken: tokens.accessToken });
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
    isOwner,
    permissions,
    setSession,
    setTokensOnly,
    clear,
    login,
    logout,
    initialize,
  };
});
