import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';
import { ApiError, type ApiErrorPayload } from '@/types/api';
import { readXsrfToken } from '@/lib/csrf';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';

// Endpoints excluded from the 401-refresh loop — failing here is a real
// auth failure (bad credentials / invalid refresh token), not "token expired".
const AUTH_BYPASS_PATHS = ['/auth/login', '/auth/refresh', '/auth/logout'];

export const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  // Send cookies (the HttpOnly refresh token + the CSRF cookies) with requests.
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

// ---------- Request: attach access token ----------

apiClient.interceptors.request.use((config) => {
  // Lazy import to avoid a circular dependency between the client and the
  // auth store (the store calls the client during login/refresh).
  const accessToken = getAccessTokenLazy();
  if (accessToken && config.headers) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  // CSRF double-submit: echo the readable XSRF-TOKEN cookie back as a header so
  // the cookie-authenticated endpoints (/auth/refresh, /auth/logout) can validate it.
  const xsrfToken = readXsrfToken();
  if (xsrfToken && config.headers) {
    config.headers['X-XSRF-TOKEN'] = xsrfToken;
  }
  return config;
});

// ---------- Response: refresh-on-401 + error normalization ----------

let refreshInFlight: Promise<string | null> | null = null;

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorPayload>) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    const status = error.response?.status;
    const url = original?.url ?? '';
    const isAuthBypass = AUTH_BYPASS_PATHS.some((p) => url.includes(p));

    if (status === 401 && !original._retry && !isAuthBypass) {
      original._retry = true;
      try {
        const newAccessToken = await ensureRefresh();
        if (newAccessToken) {
          if (original.headers) {
            original.headers.Authorization = `Bearer ${newAccessToken}`;
          }
          return apiClient.request(original);
        }
      } catch {
        /* fall through to normalized error */
      }
      await handleAuthFailure();
    }

    throw toApiError(error);
  },
);

function toApiError(error: AxiosError<ApiErrorPayload>): ApiError {
  const payload = error.response?.data;
  if (payload && typeof payload === 'object' && 'code' in payload && 'statusCode' in payload) {
    return ApiError.fromPayload(payload);
  }
  if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
    return new ApiError(0, 'NETWORK_TIMEOUT', 'Request timed out');
  }
  if (!error.response) {
    return new ApiError(0, 'NETWORK_ERROR', error.message || 'Network error');
  }
  return new ApiError(
    error.response.status,
    'UNKNOWN_ERROR',
    error.message || 'Unknown error',
  );
}

async function ensureRefresh(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function doRefresh(): Promise<string | null> {
  // The refresh token now travels as an HttpOnly cookie the browser attaches
  // automatically, so there is nothing to read or send in the body. We still use
  // a bare axios call (not apiClient) to stay outside the 401-refresh loop, so we
  // must opt into credentials + the CSRF header explicitly. No XSRF cookie ⇒ no
  // active session to refresh.
  const xsrfToken = readXsrfToken();
  if (!xsrfToken) return null;
  try {
    const res = await axios.post<{ accessToken: string; expiresIn: number }>(
      `${BASE_URL}/auth/refresh`,
      undefined,
      { withCredentials: true, headers: { 'X-XSRF-TOKEN': xsrfToken } },
    );
    setAccessTokenLazy(res.data.accessToken);
    return res.data.accessToken;
  } catch {
    return null;
  }
}

// ---------- Lazy store accessors (avoid Pinia/circular import at module load) ----------

let _accessTokenGetter: () => string | null = () => null;
let _accessTokenSetter: (t: string | null) => void = () => {};
let _onAuthFailure: () => void | Promise<void> = () => {};

export function registerAuthBindings(opts: {
  getAccessToken: () => string | null;
  setAccessToken: (t: string | null) => void;
  onAuthFailure: () => void | Promise<void>;
}) {
  _accessTokenGetter = opts.getAccessToken;
  _accessTokenSetter = opts.setAccessToken;
  _onAuthFailure = opts.onAuthFailure;
}

function getAccessTokenLazy(): string | null {
  return _accessTokenGetter();
}

function setAccessTokenLazy(token: string | null): void {
  _accessTokenSetter(token);
}

async function handleAuthFailure(): Promise<void> {
  await _onAuthFailure();
}

// ---------- Tiny helpers used by per-module API files ----------

export async function apiGet<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const res = await apiClient.get<T>(url, config);
  return res.data;
}

export async function apiPost<T>(
  url: string,
  body?: unknown,
  config?: AxiosRequestConfig,
): Promise<T> {
  const res = await apiClient.post<T>(url, body, config);
  return res.data;
}

export async function apiPatch<T>(
  url: string,
  body?: unknown,
  config?: AxiosRequestConfig,
): Promise<T> {
  const res = await apiClient.patch<T>(url, body, config);
  return res.data;
}

export async function apiPut<T>(
  url: string,
  body?: unknown,
  config?: AxiosRequestConfig,
): Promise<T> {
  const res = await apiClient.put<T>(url, body, config);
  return res.data;
}

export async function apiDelete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const res = await apiClient.delete<T>(url, config);
  return res.data;
}
