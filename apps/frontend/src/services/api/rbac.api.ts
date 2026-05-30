import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from './client';
import type {
  CreateRoleInput,
  Permission,
  PermissionMatrix,
  Role,
  UpdateRoleInput,
} from '@/types/rbac';

export const rbacApi = {
  getPermissions: (): Promise<Permission[]> => apiGet('/rbac/permissions'),

  getMatrix: (): Promise<PermissionMatrix> => apiGet('/rbac/matrix'),

  listRoles: (): Promise<Role[]> => apiGet('/rbac/roles'),

  getRole: (id: string): Promise<Role> => apiGet(`/rbac/roles/${id}`),

  createRole: (input: CreateRoleInput): Promise<Role> => apiPost('/rbac/roles', input),

  updateRole: (id: string, input: UpdateRoleInput): Promise<Role> =>
    apiPatch(`/rbac/roles/${id}`, input),

  deleteRole: (id: string): Promise<void> => apiDelete(`/rbac/roles/${id}`),

  getRolePermissions: (id: string): Promise<{ permissions: string[] }> =>
    apiGet(`/rbac/roles/${id}/permissions`),

  setRolePermissions: (id: string, permissions: string[]): Promise<{ permissions: string[] }> =>
    apiPut(`/rbac/roles/${id}/permissions`, { permissions }),
};
