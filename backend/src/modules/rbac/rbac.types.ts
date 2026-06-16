export interface RoleDto {
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

export interface PermissionDto {
  key: string;
  module: string;
  action: string;
  displayName: string;
  description: string | null;
}

export interface MatrixDto {
  modules: Array<{ key: string; permissions: PermissionDto[] }>;
  roles: Array<Pick<RoleDto, 'id' | 'name' | 'displayName' | 'isSystem' | 'isProtected'>>;
  // cells[roleName][permissionKey] = boolean
  cells: Record<string, Record<string, boolean>>;
}
