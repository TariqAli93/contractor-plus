// Wrapped localStorage access. Access token lives in memory (Pinia store);
// only the long-lived refresh token is persisted here so it survives reloads.

const REFRESH_TOKEN_KEY = 'contractor-plus.refresh-token';

function safeGet(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* storage unavailable — silently ignore */
  }
}

function safeRemove(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    /* storage unavailable — silently ignore */
  }
}

export const tokenStorage = {
  getRefreshToken: () => safeGet(REFRESH_TOKEN_KEY),
  setRefreshToken: (token: string) => safeSet(REFRESH_TOKEN_KEY, token),
  clearRefreshToken: () => safeRemove(REFRESH_TOKEN_KEY),
};
