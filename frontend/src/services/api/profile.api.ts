import { apiGet, apiPatch, apiPost } from './client';
import type { UserProfile } from '@/types/auth';
import type { ChangePasswordInput, UpdateProfileInput } from '@/types/profile';

export const profileApi = {
  get: (): Promise<UserProfile> => apiGet('/profile'),

  update: (input: UpdateProfileInput): Promise<UserProfile> => apiPatch('/profile', input),

  changePassword: (input: ChangePasswordInput): Promise<{ success: boolean }> =>
    apiPost('/profile/change-password', input),
};
