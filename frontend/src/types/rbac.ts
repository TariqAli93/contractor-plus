export interface Role {
  id: string;
  name: string;
  displayName: string | null;
  description: string | null;
  sortOrder: number;
  isSystem: boolean;
  isProtected: boolean;
  isActive: boolean;
  userCount: number;
  permissionCount: number;
}

export interface CreateRoleInput {
  name: string;
  displayName: string;
  description?: string | null;
  sortOrder?: number;
}

export interface UpdateRoleInput {
  displayName?: string;
  description?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

export interface Permission {
  key: string;
  module: string;
  action: string;
  displayName: string;
  description: string | null;
}

export interface MatrixRole {
  id: string;
  name: string;
  displayName: string | null;
  isSystem: boolean;
  isProtected: boolean;
}

export interface PermissionMatrix {
  modules: Array<{ key: string; permissions: Permission[] }>;
  roles: MatrixRole[];
  // cells[roleName][permissionKey] = boolean
  cells: Record<string, Record<string, boolean>>;
}
