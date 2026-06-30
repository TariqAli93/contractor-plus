import { apiGet, apiPost } from './client';
import type { LoginInput, LoginResponse, TokenPair, UserProfile } from '@/types/auth';

export const authApi = {
  login: (input: LoginInput): Promise<LoginResponse> => apiPost('/auth/login', input),

  // Refresh / logout are authenticated by the HttpOnly refresh cookie — no body.
  refresh: (): Promise<TokenPair> => apiPost('/auth/refresh'),

  logout: (): Promise<void> => apiPost('/auth/logout'),

  logoutAll: (): Promise<void> => apiPost('/auth/logout-all'),

  me: (): Promise<UserProfile> => apiGet('/auth/me'),
};
