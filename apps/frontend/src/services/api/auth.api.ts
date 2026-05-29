import { apiGet, apiPost } from './client';
import type { LoginInput, LoginResponse, TokenPair, UserProfile } from '@/types/auth';

export const authApi = {
  login: (input: LoginInput): Promise<LoginResponse> => apiPost('/auth/login', input),

  refresh: (input: { refreshToken: string }): Promise<TokenPair> =>
    apiPost('/auth/refresh', input),

  logout: (input: { refreshToken: string }): Promise<void> =>
    apiPost('/auth/logout', input),

  logoutAll: (): Promise<void> => apiPost('/auth/logout-all'),

  me: (): Promise<UserProfile> => apiGet('/auth/me'),
};
