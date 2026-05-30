import { apiDelete, apiGet, apiPatch, apiPost } from './client';
import type {
  CreateUserInput,
  ListUsersQuery,
  UpdateUserInput,
  User,
} from '@/types/user';
import type { Paginated } from '@/types/pagination';

export const usersApi = {
  list: (query: ListUsersQuery): Promise<Paginated<User>> => apiGet('/users', { params: query }),

  get: (id: string): Promise<User> => apiGet(`/users/${id}`),

  create: (input: CreateUserInput): Promise<User> => apiPost('/users', input),

  update: (id: string, input: UpdateUserInput): Promise<User> => apiPatch(`/users/${id}`, input),

  remove: (id: string): Promise<void> => apiDelete(`/users/${id}`),

  activate: (id: string): Promise<User> => apiPost(`/users/${id}/activate`),

  deactivate: (id: string): Promise<User> => apiPost(`/users/${id}/deactivate`),

  resetPassword: (id: string, newPassword: string): Promise<{ success: boolean }> =>
    apiPost(`/users/${id}/reset-password`, { newPassword }),
};
